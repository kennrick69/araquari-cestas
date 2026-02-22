/**
 * Mercado Pago - Integracao de Pagamentos
 * Usando SDK oficial mercadopago v2
 * 
 * Suporta: PIX, Boleto, Cartao de Credito
 * Docs: https://www.mercadopago.com.br/developers/pt/reference
 */

const { MercadoPagoConfig, Payment, PaymentRefund } = require('mercadopago');

class MercadoPagoService {
    constructor() {
        this.accessToken = process.env.MP_ACCESS_TOKEN;
        this.publicKey = process.env.MP_PUBLIC_KEY;
        this.pixKey = process.env.MP_PIX_KEY;

        if (this.accessToken) {
            this.client = new MercadoPagoConfig({
                accessToken: this.accessToken,
                options: { timeout: 15000 }
            });
            this.payment = new Payment(this.client);
            this.refund = new PaymentRefund(this.client);
        }
    }

    isConfigured() {
        return !!(this.accessToken && this.client);
    }

    // Helper: get billing address (payer_address) or fallback to delivery address
    _billingAddress(pedido) {
        const pa = pedido.payer_address || {};
        return {
            zip_code: pa.zip_code || '89245000',
            street_name: pa.street_name || pedido.endereco_rua || 'Rua Principal',
            street_number: pa.street_number || pedido.endereco_numero || 'S/N',
            neighborhood: pa.neighborhood || pedido.endereco_bairro || 'Centro',
            city: pa.city || pedido.endereco_cidade || 'Araquari',
            federal_unit: pa.federal_unit || pedido.endereco_estado || 'SC'
        };
    }

    // Helper: get delivery address (always from pedido)
    _deliveryAddress(pedido) {
        return {
            zip_code: '89245000',
            street_name: pedido.endereco_rua || '',
            street_number: parseInt(pedido.endereco_numero) || 0,
            city_name: pedido.endereco_cidade || 'Araquari',
            state_name: pedido.endereco_estado || 'SC'
        };
    }

    // Helper: payer name parts
    _payerName(pedido) {
        const nome = pedido.recebedor_nome || 'Cliente';
        const partes = nome.split(' ');
        return { first: partes[0] || 'Cliente', last: partes.slice(1).join(' ') || 'Araquari' };
    }

    // Helper: phone parts
    _phone(pedido) {
        const tel = (pedido.recebedor_telefone || '').replace(/\D/g, '');
        return { area_code: tel.slice(0, 2) || '47', number: tel.slice(2) || '' };
    }

    // PIX
    async criarPix(pedido) {
        const idempotency = `pix-${pedido.codigo}-${Date.now()}`;
        const { first, last } = this._payerName(pedido);
        const body = {
            transaction_amount: parseFloat(parseFloat(pedido.total).toFixed(2)),
            description: `${pedido.cesta_nome} - Pedido ${pedido.codigo}`,
            external_reference: pedido.codigo,
            payment_method_id: 'pix',
            payer: {
                email: pedido.email || 'cliente@araquaricestas.com',
                first_name: first, last_name: last,
                identification: { type: 'CPF', number: pedido.cpf ? pedido.cpf.replace(/\D/g, '') : '00000000000' }
            }
        };
        const data = await this.payment.create({ body, requestOptions: { idempotencyKey: idempotency } });
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
        const idempotency = `boleto-${pedido.codigo}-${Date.now()}`;
        const vencimento = new Date();
        vencimento.setDate(vencimento.getDate() + diasVencimento);
        const { first, last } = this._payerName(pedido);
        const cpfLimpo = pedido.cpf ? pedido.cpf.replace(/\D/g, '') : '';
        if (!cpfLimpo || cpfLimpo.length !== 11) throw new Error('CPF do pagador e obrigatorio para gerar boleto');
        const phone = this._phone(pedido);
        const billing = this._billingAddress(pedido);
        const delivery = this._deliveryAddress(pedido);

        const body = {
            transaction_amount: parseFloat(parseFloat(pedido.total).toFixed(2)),
            description: `${pedido.cesta_nome} - Pedido ${pedido.codigo}`,
            external_reference: pedido.codigo,
            statement_descriptor: 'ARAQUARI CESTAS',
            payment_method_id: 'bolbradesco',
            payer: {
                email: pedido.email || 'cliente@araquaricestas.com',
                first_name: first, last_name: last,
                identification: { type: 'CPF', number: cpfLimpo },
                address: billing
            },
            additional_info: {
                items: [{ id: pedido.cesta_tipo || 'cesta', title: pedido.cesta_nome || 'Cesta', description: `${pedido.cesta_nome} x${pedido.quantidade || 1}`, quantity: pedido.quantidade || 1, unit_price: parseFloat(pedido.cesta_preco || pedido.total), category_id: 'food' }],
                payer: { first_name: first, last_name: last, phone: phone, address: { zip_code: billing.zip_code, street_name: billing.street_name, street_number: parseInt(billing.street_number) || 0 } },
                shipments: { receiver_address: delivery }
            },
            date_of_expiration: vencimento.toISOString()
        };
        const data = await this.payment.create({ body, requestOptions: { idempotencyKey: idempotency } });
        return { paymentId: data.id, status: data.status, boletoUrl: data.transaction_details?.external_resource_url || '', barcode: data.barcode?.content || '', vencimento: vencimento.toISOString().slice(0, 10), valor: data.transaction_amount };
    }

    async criarBoleto30(pedido) { return this.criarBoleto(pedido, 30); }

    // CARTAO
    async criarCartao(pedido, token, parcelas = 1, email = null) {
        const idempotency = `card-${pedido.codigo}-${Date.now()}`;
        const { first, last } = this._payerName(pedido);
        const cpfLimpo = pedido.cpf ? pedido.cpf.replace(/\D/g, '') : '';
        const phone = this._phone(pedido);
        const billing = this._billingAddress(pedido);
        const delivery = this._deliveryAddress(pedido);

        const body = {
            transaction_amount: parseFloat(parseFloat(pedido.total).toFixed(2)),
            description: `${pedido.cesta_nome} - Pedido ${pedido.codigo}`,
            external_reference: pedido.codigo,
            statement_descriptor: 'ARAQUARI CESTAS',
            token: token,
            installments: parcelas,
            payer: {
                email: email || pedido.email || 'cliente@araquaricestas.com',
                first_name: first, last_name: last,
                identification: { type: 'CPF', number: cpfLimpo || '00000000000' },
                address: billing
            },
            additional_info: {
                items: [{ id: pedido.cesta_tipo || 'cesta', title: pedido.cesta_nome || 'Cesta', description: `${pedido.cesta_nome} x${pedido.quantidade || 1}`, quantity: pedido.quantidade || 1, unit_price: parseFloat(pedido.cesta_preco || pedido.total), category_id: 'food' }],
                payer: { first_name: first, last_name: last, phone: phone, address: { zip_code: billing.zip_code, street_name: billing.street_name, street_number: parseInt(billing.street_number) || 0 } },
                shipments: { receiver_address: delivery }
            }
        };
        if (pedido.card_payment_method) body.payment_method_id = pedido.card_payment_method;
        if (pedido.card_issuer_id) body.issuer_id = Number(pedido.card_issuer_id);

        console.log('MP Cartao request:', JSON.stringify({ payer_address: billing, delivery_address: delivery, email: body.payer.email, cpf: cpfLimpo }));

        const data = await this.payment.create({ body, requestOptions: { idempotencyKey: idempotency } });
        return { paymentId: data.id, status: data.status, statusDetail: data.status_detail, parcelas: data.installments, valor: data.transaction_amount };
    }

    async consultarPagamento(paymentId) { return this.payment.get({ id: paymentId }); }
    async reembolsar(paymentId, amount = null) { const body = amount ? { amount: parseFloat(amount) } : {}; return this.refund.create({ payment_id: paymentId, body }); }
    async cancelar(paymentId) { return this.payment.cancel({ id: paymentId }); }
}

module.exports = new MercadoPagoService();
