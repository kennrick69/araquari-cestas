/**
 * Mercado Pago - Integracao de Pagamentos
 * Checkout API (Transparente) - fetch direto
 * 
 * Suporta: PIX, Boleto, Cartao de Credito
 */

class MercadoPago {
    constructor() {
        this.accessToken = process.env.MP_ACCESS_TOKEN;
        this.publicKey = process.env.MP_PUBLIC_KEY;
        this.pixKey = process.env.MP_PIX_KEY;
        this.baseUrl = 'https://api.mercadopago.com';
    }

    isConfigured() {
        return !!(this.accessToken);
    }

    _headers(idempotencyKey) {
        const h = {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
        };
        if (idempotencyKey) h['X-Idempotency-Key'] = idempotencyKey;
        return h;
    }

    async _request(method, path, body = null, idempotencyKey = null) {
        const url = `${this.baseUrl}${path}`;
        const options = { method, headers: this._headers(idempotencyKey) };
        if (body) options.body = JSON.stringify(body);
        const res = await fetch(url, options);
        const data = await res.json();
        if (!res.ok) {
            console.error('MP API Error:', res.status, JSON.stringify(data));
            throw new Error(data.message || data.error || `Erro MP API: ${res.status}`);
        }
        return data;
    }

    // PIX
    async criarPix(pedido) {
        const body = {
            transaction_amount: parseFloat(parseFloat(pedido.total).toFixed(2)),
            description: `${pedido.cesta_nome} - Pedido ${pedido.codigo}`,
            external_reference: pedido.codigo,
            payment_method_id: 'pix',
            payer: {
                email: pedido.email || 'cliente@araquaricestas.com',
                first_name: pedido.recebedor_nome ? pedido.recebedor_nome.split(' ')[0] : 'Cliente',
                last_name: pedido.recebedor_nome ? pedido.recebedor_nome.split(' ').slice(1).join(' ') || 'Araquari' : 'Araquari',
                identification: { type: 'CPF', number: pedido.cpf ? pedido.cpf.replace(/\D/g, '') : '00000000000' }
            }
        };
        const data = await this._request('POST', '/v1/payments', body, `pix-${pedido.codigo}-${Date.now()}`);
        return {
            paymentId: data.id, status: data.status,
            qrcode: data.point_of_interaction?.transaction_data?.qr_code || '',
            qrcodeBase64: data.point_of_interaction?.transaction_data?.qr_code_base64 || '',
            ticketUrl: data.point_of_interaction?.transaction_data?.ticket_url || '',
            valor: data.transaction_amount, expiracao: data.date_of_expiration
        };
    }

    // BOLETO
    async criarBoleto(pedido, diasVencimento = 3) {
        const vencimento = new Date();
        vencimento.setDate(vencimento.getDate() + diasVencimento);
        const nome = pedido.recebedor_nome || 'Cliente';
        const partes = nome.split(' ');
        const cpfLimpo = pedido.cpf ? pedido.cpf.replace(/\D/g, '') : '';
        if (!cpfLimpo || cpfLimpo.length !== 11) throw new Error('CPF do pagador e obrigatorio para gerar boleto');
        const tel = (pedido.recebedor_telefone || '').replace(/\D/g, '');

        const body = {
            transaction_amount: parseFloat(parseFloat(pedido.total).toFixed(2)),
            description: `${pedido.cesta_nome} - Pedido ${pedido.codigo}`,
            external_reference: pedido.codigo,
            statement_descriptor: 'ARAQUARI CESTAS',
            payment_method_id: 'bolbradesco',
            payer: {
                email: pedido.email || 'cliente@araquaricestas.com',
                first_name: partes[0] || 'Cliente', last_name: partes.slice(1).join(' ') || 'Araquari',
                identification: { type: 'CPF', number: cpfLimpo },
                address: { zip_code: '89245000', street_name: pedido.endereco_rua || 'Rua Principal', street_number: pedido.endereco_numero || 'S/N', neighborhood: pedido.endereco_bairro || 'Centro', city: pedido.endereco_cidade || 'Araquari', federal_unit: pedido.endereco_estado || 'SC' }
            },
            additional_info: {
                items: [{ id: pedido.cesta_tipo || 'cesta', title: pedido.cesta_nome || 'Cesta', description: `${pedido.cesta_nome} x${pedido.quantidade || 1}`, quantity: pedido.quantidade || 1, unit_price: parseFloat(pedido.cesta_preco || pedido.total), category_id: 'food' }],
                payer: { first_name: partes[0] || 'Cliente', last_name: partes.slice(1).join(' ') || 'Araquari', phone: { area_code: tel.slice(0, 2) || '47', number: tel.slice(2) || '' }, address: { zip_code: '89245000', street_name: pedido.endereco_rua || '', street_number: parseInt(pedido.endereco_numero) || 0 } },
                shipments: { receiver_address: { zip_code: '89245000', street_name: pedido.endereco_rua || '', street_number: parseInt(pedido.endereco_numero) || 0, city_name: pedido.endereco_cidade || 'Araquari', state_name: pedido.endereco_estado || 'SC' } }
            },
            date_of_expiration: vencimento.toISOString()
        };
        const data = await this._request('POST', '/v1/payments', body, `boleto-${pedido.codigo}-${Date.now()}`);
        return { paymentId: data.id, status: data.status, boletoUrl: data.transaction_details?.external_resource_url || '', barcode: data.barcode?.content || '', vencimento: vencimento.toISOString().slice(0, 10), valor: data.transaction_amount };
    }

    async criarBoleto30(pedido) { return this.criarBoleto(pedido, 30); }

    // CARTAO - identico ao que funcionou ontem
    async criarCartao(pedido, token, parcelas = 1, email = null) {
        const nome = pedido.recebedor_nome || 'Cliente';
        const partes = nome.split(' ');
        const cpfLimpo = pedido.cpf ? pedido.cpf.replace(/\D/g, '') : '';
        const tel = (pedido.recebedor_telefone || '').replace(/\D/g, '');

        const body = {
            transaction_amount: parseFloat(parseFloat(pedido.total).toFixed(2)),
            description: `${pedido.cesta_nome} - Pedido ${pedido.codigo}`,
            external_reference: pedido.codigo,
            statement_descriptor: 'ARAQUARI CESTAS',
            token: token,
            installments: parcelas,
            payer: {
                email: email || pedido.email || 'cliente@araquaricestas.com',
                first_name: partes[0] || 'Cliente', last_name: partes.slice(1).join(' ') || 'Araquari',
                identification: { type: 'CPF', number: cpfLimpo || '00000000000' },
                address: { zip_code: '89245000', street_name: pedido.endereco_rua || '', street_number: pedido.endereco_numero || '0', neighborhood: pedido.endereco_bairro || '', city: pedido.endereco_cidade || 'Araquari', federal_unit: pedido.endereco_estado || 'SC' }
            },
            additional_info: {
                items: [{ id: pedido.cesta_tipo || 'cesta', title: pedido.cesta_nome || 'Cesta', description: `${pedido.cesta_nome} x${pedido.quantidade || 1}`, quantity: pedido.quantidade || 1, unit_price: parseFloat(pedido.cesta_preco || pedido.total), category_id: 'food' }],
                payer: { first_name: partes[0] || 'Cliente', last_name: partes.slice(1).join(' ') || 'Araquari', phone: { area_code: tel.slice(0, 2) || '47', number: tel.slice(2) || '' }, address: { zip_code: '89245000', street_name: pedido.endereco_rua || '', street_number: parseInt(pedido.endereco_numero) || 0 } },
                shipments: { receiver_address: { zip_code: '89245000', street_name: pedido.endereco_rua || '', street_number: parseInt(pedido.endereco_numero) || 0, city_name: pedido.endereco_cidade || 'Araquari', state_name: pedido.endereco_estado || 'SC' } }
            }
        };

        const data = await this._request('POST', '/v1/payments', body, `card-${pedido.codigo}-${Date.now()}`);
        return { paymentId: data.id, status: data.status, statusDetail: data.status_detail, parcelas: data.installments, valor: data.transaction_amount };
    }

    async consultarPagamento(paymentId) { return this._request('GET', `/v1/payments/${paymentId}`); }
    async reembolsar(paymentId, amount = null) { const body = amount ? { amount: parseFloat(amount) } : {}; return this._request('POST', `/v1/payments/${paymentId}/refunds`, body); }
    async cancelar(paymentId) { return this._request('PUT', `/v1/payments/${paymentId}`, { status: 'cancelled' }); }
}

module.exports = new MercadoPago();
