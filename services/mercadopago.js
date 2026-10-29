/**
 * Mercado Pago - Integracao de Pagamentos
 * Checkout API (Transparente)
 * 
 * Suporta: PIX, Boleto, Cartao de Credito
 * Docs: https://www.mercadopago.com.br/developers/pt/reference
 */

class MercadoPago {
    constructor() {
        // Bootstrap da env Railway. reloadFromDB() sobrescreve com o painel
        // na primeira chamada; env só persiste se o DB estiver vazio.
        this.accessToken = process.env.MP_ACCESS_TOKEN || null;
        this.publicKey = process.env.MP_PUBLIC_KEY || null;
        this.pixKey = process.env.MP_PIX_KEY || null;
        this.webhookSecret = process.env.MP_WEBHOOK_SECRET || null;
        this.lojaEmail = null; // loja_email do app_config; fallback de payer.email (ver _payerEmail)
        this.baseUrl = 'https://api.mercadopago.com';
        this._dbLoaded = false;
        // Origem da credencial em uso: 'database' | 'env' | null (nada setado)
        this.source = this.accessToken ? 'env' : null;
    }

    isConfigured() {
        return !!(this.accessToken);
    }

    // Carrega credenciais do banco de dados.
    // Regra: banco é fonte canônica. Env Railway é fallback só quando banco vazio.
    // Chamado automaticamente pelo PUT /config quando admin salva mp_*.
    async reloadFromDB() {
        try {
            const pool = require('../db/pool');
            const tableCheck = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'app_config')`);
            if(!tableCheck.rows[0].exists) {
                console.warn('[MP] app_config não existe ainda — usando env Railway como fallback');
                this.source = this.accessToken ? 'env' : null;
                this._dbLoaded = true;
                return;
            }

            const result = await pool.query("SELECT chave, valor FROM app_config WHERE chave LIKE 'mp_%' OR chave = 'loja_email'");
            const config = {};
            result.rows.forEach(r => { config[r.chave] = r.valor; });

            // DB tem prioridade. Só mantém env se DB está vazio pra aquela chave.
            if (config.mp_access_token) {
                this.accessToken = config.mp_access_token;
                this.source = 'database';
            } else if (process.env.MP_ACCESS_TOKEN) {
                this.accessToken = process.env.MP_ACCESS_TOKEN;
                this.source = 'env';
                console.warn('[MP] mp_access_token vazio no painel — caindo pra MP_ACCESS_TOKEN da env Railway. Peça o cliente cadastrar no admin.');
            } else {
                this.accessToken = null;
                this.source = null;
            }
            // Demais chaves seguem a mesma lógica mas sem log de aviso dedicado
            this.publicKey = config.mp_public_key || process.env.MP_PUBLIC_KEY || null;
            this.webhookSecret = config.mp_webhook_secret || process.env.MP_WEBHOOK_SECRET || null;
            this.lojaEmail = config.loja_email || null;

            this._dbLoaded = true;
            console.log(`[MP] credenciais recarregadas · source=${this.source} · configurado=${this.isConfigured()}`);
        } catch(e) {
            console.error('[MP] erro ao ler app_config:', e.message, '— mantendo env como fallback');
            this.source = this.accessToken ? 'env' : null;
        }
    }

    // Garante que credenciais do DB foram carregadas
    async _ensureLoaded() {
        if(!this._dbLoaded) await this.reloadFromDB();
    }

    // E-mail do pagador: comprador informado > loja_email do painel (app_config)
    // > último recurso fixo. ATENÇÃO: não pode ser igual ao e-mail da conta
    // vendedora do MP — o MP recusa pagamento com payer.email == seller.
    _payerEmail(pedido, override = null) {
        return override || (pedido && pedido.email) || this.lojaEmail || 'contato@conversecommaria.com.br';
    }

    // ══════════════════════════════
    // Headers padrao
    // ══════════════════════════════
    _headers(idempotencyKey) {
        const h = {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
        };
        if (idempotencyKey) {
            h['X-Idempotency-Key'] = idempotencyKey;
        }
        return h;
    }

    // ══════════════════════════════
    // Request generico
    // ══════════════════════════════
    async _request(method, path, body = null, idempotencyKey = null) {
        await this._ensureLoaded();
        const url = `${this.baseUrl}${path}`;
        const options = {
            method,
            headers: this._headers(idempotencyKey)
        };
        if (body) options.body = JSON.stringify(body);

        const res = await fetch(url, options);
        const data = await res.json();

        if (!res.ok) {
            console.error('MP API Error:', res.status, JSON.stringify(data));
            throw new Error(data.message || data.error || `Erro MP API: ${res.status}`);
        }

        return data;
    }

    // ══════════════════════════════
    // PIX - Criar pagamento
    // ══════════════════════════════
    async criarPix(pedido) {
        const idempotency = `pix-${pedido.codigo}-${Date.now()}`;
        await this._ensureLoaded();

        const body = {
            transaction_amount: parseFloat(parseFloat(pedido.total).toFixed(2)),
            description: `${pedido.cesta_nome} - Pedido ${pedido.codigo}`,
            external_reference: pedido.codigo,
            payment_method_id: 'pix',
            payer: {
                email: this._payerEmail(pedido),
                first_name: pedido.recebedor_nome ? pedido.recebedor_nome.split(' ')[0] : 'Cliente',
                last_name: pedido.recebedor_nome ? pedido.recebedor_nome.split(' ').slice(1).join(' ') || 'Araquari' : 'Araquari',
                identification: {
                    type: 'CPF',
                    number: pedido.cpf ? pedido.cpf.replace(/\D/g, '') : '00000000000'
                }
            }
        };

        const data = await this._request('POST', '/v1/payments', body, idempotency);

        return {
            paymentId: data.id,
            status: data.status,
            qrcode: data.point_of_interaction?.transaction_data?.qr_code || '',
            qrcodeBase64: data.point_of_interaction?.transaction_data?.qr_code_base64 || '',
            ticketUrl: data.point_of_interaction?.transaction_data?.ticket_url || '',
            valor: data.transaction_amount,
            expiracao: data.date_of_expiration
        };
    }

    // ══════════════════════════════
    // BOLETO - Criar pagamento (3 dias ou 30 dias)
    // ══════════════════════════════
    async criarBoleto(pedido, diasVencimento = 3) {
        const idempotency = `boleto-${pedido.codigo}-${Date.now()}`;
        await this._ensureLoaded();

        const vencimento = new Date();
        vencimento.setDate(vencimento.getDate() + diasVencimento);

        const nome = pedido.recebedor_nome || 'Cliente';
        const partes = nome.split(' ');
        const cpfLimpo = pedido.cpf ? pedido.cpf.replace(/\D/g, '') : '';
        if(!cpfLimpo || cpfLimpo.length !== 11) {
            throw new Error('CPF do pagador \u00E9 obrigat\u00F3rio para gerar boleto');
        }

        const tel = (pedido.recebedor_telefone || '').replace(/\D/g, '');

        const body = {
            transaction_amount: parseFloat(parseFloat(pedido.total).toFixed(2)),
            description: `${pedido.cesta_nome} - Pedido ${pedido.codigo}`,
            external_reference: pedido.codigo,
            statement_descriptor: 'ARAQUARI CESTAS',
            payment_method_id: 'bolbradesco',
            payer: {
                email: this._payerEmail(pedido),
                first_name: partes[0] || 'Cliente',
                last_name: partes.slice(1).join(' ') || 'Araquari',
                identification: {
                    type: 'CPF',
                    number: cpfLimpo
                },
                address: {
                    zip_code: pedido.cep || '89245000',
                    street_name: pedido.endereco_rua || 'Rua Principal',
                    street_number: pedido.endereco_numero || 'S/N',
                    neighborhood: pedido.endereco_bairro || 'Centro',
                    city: pedido.endereco_cidade || 'Araquari',
                    federal_unit: pedido.endereco_estado || 'SC'
                }
            },
            additional_info: {
                items: [{
                    id: pedido.cesta_tipo || 'cesta',
                    title: pedido.cesta_nome || 'Cesta',
                    description: `${pedido.cesta_nome} x${pedido.quantidade || 1}`,
                    quantity: pedido.quantidade || 1,
                    unit_price: parseFloat(pedido.cesta_preco || pedido.total),
                    category_id: 'food'
                }],
                payer: {
                    first_name: partes[0] || 'Cliente',
                    last_name: partes.slice(1).join(' ') || 'Araquari',
                    phone: {
                        area_code: tel.slice(0, 2) || '47',
                        number: tel.slice(2) || ''
                    },
                    address: {
                        zip_code: pedido.cep || '89245000',
                        street_name: pedido.endereco_rua || '',
                        street_number: parseInt(pedido.endereco_numero) || 0
                    }
                },
                shipments: {
                    receiver_address: {
                        zip_code: pedido.cep || '89245000',
                        street_name: pedido.endereco_rua || '',
                        street_number: parseInt(pedido.endereco_numero) || 0,
                        city_name: pedido.endereco_cidade || 'Araquari',
                        state_name: pedido.endereco_estado || 'SC'
                    }
                }
            },
            date_of_expiration: vencimento.toISOString()
        };

        const data = await this._request('POST', '/v1/payments', body, idempotency);

        return {
            paymentId: data.id,
            status: data.status,
            boletoUrl: data.transaction_details?.external_resource_url || '',
            barcode: data.barcode?.content || '',
            vencimento: vencimento.toISOString().slice(0, 10),
            valor: data.transaction_amount
        };
    }

    // ══════════════════════════════
    // BOLETO 30 DIAS
    // ══════════════════════════════
    async criarBoleto30(pedido) {
        return this.criarBoleto(pedido, 30);
    }

    // ══════════════════════════════
    // CARTAO - Criar pagamento
    // ══════════════════════════════
    async criarCartao(pedido, token, parcelas = 1, email = null) {
        const idempotency = `card-${pedido.codigo}-${Date.now()}`;
        await this._ensureLoaded();

        const nome = pedido.recebedor_nome || 'Cliente';
        const partes = nome.split(' ');
        const cpfLimpo = pedido.cpf ? pedido.cpf.replace(/\D/g, '') : '';

        const body = {
            transaction_amount: parseFloat(parseFloat(pedido.total).toFixed(2)),
            description: `${pedido.cesta_nome} - Pedido ${pedido.codigo}`,
            external_reference: pedido.codigo,
            statement_descriptor: 'ARAQUARI CESTAS',
            token: token,
            installments: parcelas,
            payer: {
                email: this._payerEmail(pedido, email),
                first_name: partes[0] || 'Cliente',
                last_name: partes.slice(1).join(' ') || 'Araquari',
                identification: {
                    type: 'CPF',
                    number: cpfLimpo || '00000000000'
                },
                address: {
                    zip_code: pedido.cep || '89245000',
                    street_name: pedido.endereco_rua || '',
                    street_number: pedido.endereco_numero || '0',
                    neighborhood: pedido.endereco_bairro || '',
                    city: pedido.endereco_cidade || 'Araquari',
                    federal_unit: pedido.endereco_estado || 'SC'
                }
            },
            additional_info: {
                items: [{
                    id: pedido.cesta_tipo || 'cesta',
                    title: pedido.cesta_nome || 'Cesta',
                    description: `${pedido.cesta_nome} x${pedido.quantidade || 1}`,
                    quantity: pedido.quantidade || 1,
                    unit_price: parseFloat(pedido.cesta_preco || pedido.total),
                    category_id: 'food'
                }],
                payer: {
                    first_name: partes[0] || 'Cliente',
                    last_name: partes.slice(1).join(' ') || 'Araquari',
                    phone: {
                        area_code: (pedido.recebedor_telefone || '').replace(/\D/g, '').slice(0, 2) || '47',
                        number: (pedido.recebedor_telefone || '').replace(/\D/g, '').slice(2) || ''
                    },
                    address: {
                        zip_code: pedido.cep || '89245000',
                        street_name: pedido.endereco_rua || '',
                        street_number: parseInt(pedido.endereco_numero) || 0
                    }
                },
                shipments: {
                    receiver_address: {
                        zip_code: pedido.cep || '89245000',
                        street_name: pedido.endereco_rua || '',
                        street_number: parseInt(pedido.endereco_numero) || 0,
                        city_name: pedido.endereco_cidade || 'Araquari',
                        state_name: pedido.endereco_estado || 'SC'
                    }
                }
            }
        };

        // Remover payment_method_id se não definido
        if (pedido.card_payment_method) body.payment_method_id = pedido.card_payment_method;

        const data = await this._request('POST', '/v1/payments', body, idempotency);

        return {
            paymentId: data.id,
            status: data.status,
            statusDetail: data.status_detail,
            parcelas: data.installments,
            valor: data.transaction_amount
        };
    }

    // ══════════════════════════════
    // Validar assinatura do webhook (x-signature / x-request-id)
    // Retorna: { enforced: bool, valid: bool }
    //  - enforced=false quando nao ha secret configurado (compat retro)
    // ══════════════════════════════
    async validarWebhook(headers, dataId) {
        await this._ensureLoaded();
        const secret = this.webhookSecret || process.env.MP_WEBHOOK_SECRET;
        if (!secret) {
            // Sem secret configurado: nao ha como validar. Nao bloqueia (compat).
            return { enforced: false, valid: false };
        }

        const crypto = require('crypto');
        const sigHeader = headers['x-signature'] || '';
        const requestId = headers['x-request-id'] || '';

        // x-signature: "ts=1699...,v1=abc123..."
        let ts = '', v1 = '';
        sigHeader.split(',').forEach(part => {
            const [k, val] = part.split('=');
            if (!k || val === undefined) return;
            const key = k.trim();
            if (key === 'ts') ts = val.trim();
            if (key === 'v1') v1 = val.trim();
        });

        if (!ts || !v1) return { enforced: true, valid: false };

        // Manifest conforme docs MP: id + request-id + ts
        const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
        const computed = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

        let valid = false;
        try {
            valid = crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(v1));
        } catch (_) {
            valid = false;
        }
        return { enforced: true, valid };
    }

    // ══════════════════════════════
    // Consultar pagamento
    // ══════════════════════════════
    async consultarPagamento(paymentId) {
        return this._request('GET', `/v1/payments/${paymentId}`);
    }

    // ══════════════════════════════
    // Reembolso (total ou parcial)
    // ══════════════════════════════
    async reembolsar(paymentId, amount = null) {
        const body = amount ? { amount: parseFloat(amount) } : {};
        return this._request('POST', `/v1/payments/${paymentId}/refunds`, body);
    }

    // ══════════════════════════════
    // Cancelar pagamento pendente
    // ══════════════════════════════
    async cancelar(paymentId) {
        return this._request('PUT', `/v1/payments/${paymentId}`, { status: 'cancelled' });
    }
}

module.exports = new MercadoPago();
