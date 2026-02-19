/**
 * Efi Bank (ex-Gerencianet) - Integracao de Pagamentos
 * 
 * Suporta: PIX, Boleto, Cartao de Credito
 * Docs: https://dev.efipay.com.br/
 * 
 * Variaveis de ambiente necessarias:
 * - EFI_CLIENT_ID
 * - EFI_CLIENT_SECRET
 * - EFI_SANDBOX (true/false)
 * - EFI_PIX_KEY (chave PIX cadastrada na Efi)
 * - EFI_CERT_PATH (caminho do certificado .p12 para PIX)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

class EfiPay {
    constructor() {
        this.clientId = process.env.EFI_CLIENT_ID;
        this.clientSecret = process.env.EFI_CLIENT_SECRET;
        this.sandbox = process.env.EFI_SANDBOX === 'true';
        this.pixKey = process.env.EFI_PIX_KEY;
        this.certPath = process.env.EFI_CERT_PATH;

        // URLs da API
        this.baseUrl = this.sandbox
            ? 'https://cobrancas-h.api.efipay.com.br'
            : 'https://cobrancas.api.efipay.com.br';

        this.pixUrl = this.sandbox
            ? 'https://pix-h.api.efipay.com.br'
            : 'https://pix.api.efipay.com.br';

        this.accessToken = null;
        this.tokenExpires = 0;
    }

    isConfigured() {
        return !!(this.clientId && this.clientSecret);
    }

    // ══════════════════════════════
    // Autenticacao OAuth2
    // ══════════════════════════════
    async getToken(forPix = false) {
        if (this.accessToken && Date.now() < this.tokenExpires) {
            return this.accessToken;
        }

        const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        const url = forPix ? this.pixUrl : this.baseUrl;

        const options = {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            }
        };

        // PIX requer certificado
        if (forPix && this.certPath && fs.existsSync(this.certPath)) {
            const cert = fs.readFileSync(this.certPath);
            options.cert = cert;
            options.key = cert;
            options.pfx = cert;
        }

        const body = JSON.stringify({ grant_type: 'client_credentials' });

        const data = await this._request(url + '/oauth/token', options, body);
        this.accessToken = data.access_token;
        this.tokenExpires = Date.now() + (data.expires_in - 60) * 1000;
        return this.accessToken;
    }

    // ══════════════════════════════
    // PIX - Criar cobranca
    // ══════════════════════════════
    async criarPix(pedido) {
        const token = await this.getToken(true);
        const txid = pedido.codigo.replace(/-/g, '').slice(0, 35);

        const body = {
            calendario: {
                expiracao: 3600 // 1 hora
            },
            valor: {
                original: parseFloat(pedido.total).toFixed(2)
            },
            chave: this.pixKey,
            infoAdicionais: [
                { nome: 'Pedido', valor: pedido.codigo },
                { nome: 'Cesta', valor: pedido.cesta_nome }
            ]
        };

        const options = this._pixOptions('PUT', token);
        const data = await this._request(
            `${this.pixUrl}/v2/cob/${txid}`,
            options,
            JSON.stringify(body)
        );

        // Gerar QR Code
        const qrData = await this._request(
            `${this.pixUrl}/v2/loc/${data.loc.id}/qrcode`,
            this._pixOptions('GET', token)
        );

        return {
            txid: data.txid,
            status: data.status,
            qrcode: qrData.qrcode, // codigo copia-cola
            imagemQrcode: qrData.imagemQrcode, // base64 da imagem
            valor: data.valor.original,
            expiracao: data.calendario.expiracao
        };
    }

    // ══════════════════════════════
    // BOLETO - Criar cobranca
    // ══════════════════════════════
    async criarBoleto(pedido, vencimentoDias = 3) {
        const token = await this.getToken();

        const vencimento = new Date();
        vencimento.setDate(vencimento.getDate() + vencimentoDias);

        const body = {
            items: [{
                name: pedido.cesta_nome,
                value: Math.round(parseFloat(pedido.total) * 100), // centavos
                amount: pedido.quantidade || 1
            }],
            payment: {
                banking_billet: {
                    customer: {
                        name: pedido.recebedor_nome,
                        cpf: pedido.cpf ? pedido.cpf.replace(/\D/g, '') : undefined,
                        phone_number: pedido.recebedor_telefone ? pedido.recebedor_telefone.replace(/\D/g, '') : undefined
                    },
                    expire_at: vencimento.toISOString().slice(0, 10),
                    message: `Pedido ${pedido.codigo} - ${pedido.cesta_nome}`
                }
            }
        };

        const options = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        const data = await this._request(
            `${this.baseUrl}/v1/charge/one-step`,
            options,
            JSON.stringify(body)
        );

        return {
            chargeId: data.data.charge_id,
            status: data.data.status,
            boletoUrl: data.data.link,
            boletoBarcode: data.data.barcode,
            boletoPdf: data.data.pdf?.charge,
            vencimento: vencimento.toISOString().slice(0, 10)
        };
    }

    // ══════════════════════════════
    // BOLETO 30 DIAS
    // ══════════════════════════════
    async criarBoleto30(pedido) {
        return this.criarBoleto(pedido, 30);
    }

    // ══════════════════════════════
    // CARTAO DE CREDITO
    // ══════════════════════════════
    async criarCartao(pedido, cardToken, parcelas = 1) {
        const token = await this.getToken();

        const body = {
            items: [{
                name: pedido.cesta_nome,
                value: Math.round(parseFloat(pedido.total) * 100),
                amount: pedido.quantidade || 1
            }],
            payment: {
                credit_card: {
                    customer: {
                        name: pedido.recebedor_nome,
                        cpf: pedido.cpf ? pedido.cpf.replace(/\D/g, '') : undefined,
                        phone_number: pedido.recebedor_telefone ? pedido.recebedor_telefone.replace(/\D/g, '') : undefined,
                        email: pedido.email || 'cliente@araquaricestas.com'
                    },
                    installments: parcelas,
                    payment_token: cardToken
                }
            }
        };

        const options = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        const data = await this._request(
            `${this.baseUrl}/v1/charge/one-step`,
            options,
            JSON.stringify(body)
        );

        return {
            chargeId: data.data.charge_id,
            status: data.data.status,
            parcelas: parcelas
        };
    }

    // ══════════════════════════════
    // Consultar cobranca
    // ══════════════════════════════
    async consultarCobranca(chargeId) {
        const token = await this.getToken();
        const options = {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        };

        return this._request(`${this.baseUrl}/v1/charge/${chargeId}`, options);
    }

    // ══════════════════════════════
    // Helpers
    // ══════════════════════════════
    _pixOptions(method, token) {
        const opts = {
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };

        if (this.certPath && fs.existsSync(this.certPath)) {
            const cert = fs.readFileSync(this.certPath);
            opts.cert = cert;
            opts.key = cert;
            opts.pfx = cert;
        }

        return opts;
    }

    _request(url, options, body = null) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const reqOpts = {
                hostname: urlObj.hostname,
                port: 443,
                path: urlObj.pathname + urlObj.search,
                method: options.method,
                headers: options.headers || {}
            };

            // Add cert options for PIX
            if (options.pfx) reqOpts.pfx = options.pfx;
            if (options.cert) reqOpts.cert = options.cert;
            if (options.key) reqOpts.key = options.key;

            const req = https.request(reqOpts, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode >= 400) {
                            console.error('Efi API error:', res.statusCode, parsed);
                            reject(new Error(parsed.message || parsed.error_description || 'Erro Efi API'));
                        } else {
                            resolve(parsed);
                        }
                    } catch(e) {
                        reject(new Error('Resposta invalida da Efi API'));
                    }
                });
            });

            req.on('error', reject);
            if (body) req.write(body);
            req.end();
        });
    }
}

module.exports = new EfiPay();
