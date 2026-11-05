// ══════════════════════════════════════════════════════════════════
// services/routing.js
// Agrupamento por região (clusters) + ordenação de paradas de entrega.
// TUDO em memória, SEM nenhuma API paga (nem Google Directions/Distance
// Matrix). Distâncias por haversine (linha reta) — suficiente para
// agrupar vizinhos e ordenar paradas numa cidade pequena como Araquari.
// ══════════════════════════════════════════════════════════════════

const R_TERRA_KM = 6371;

function toRad(d) { return (d * Math.PI) / 180; }

// Distância haversine em km entre dois pontos {lat, lng}.
function haversine(a, b) {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const la1 = toRad(a.lat);
    const la2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ──────────────────────────────────────────────────────────────────
// Agrupamento por região (single-linkage via union-find).
// Dois pedidos ficam no MESMO grupo quando estão a menos de `raioKm`
// um do outro — e isso se propaga (vizinho do vizinho entra no grupo).
// `pontos`: [{ lat, lng, ... }]. Retorna array de clusters; cada cluster
// é um array de índices de `pontos`. Ordenado do maior grupo pro menor.
// ──────────────────────────────────────────────────────────────────
function agrupar(pontos, raioKm) {
    const n = pontos.length;
    const pai = pontos.map((_, i) => i);
    function achar(i) { while (pai[i] !== i) { pai[i] = pai[pai[i]]; i = pai[i]; } return i; }
    function unir(i, j) { const ri = achar(i), rj = achar(j); if (ri !== rj) pai[ri] = rj; }

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (haversine(pontos[i], pontos[j]) <= raioKm) unir(i, j);
        }
    }

    const buckets = new Map();
    for (let i = 0; i < n; i++) {
        const r = achar(i);
        if (!buckets.has(r)) buckets.set(r, []);
        buckets.get(r).push(i);
    }
    return [...buckets.values()].sort((a, b) => b.length - a.length);
}

// Centro (centróide simples) de uma lista de pontos.
function centro(pontos) {
    if (!pontos.length) return { lat: 0, lng: 0 };
    let lat = 0, lng = 0;
    for (const p of pontos) { lat += p.lat; lng += p.lng; }
    return { lat: lat / pontos.length, lng: lng / pontos.length };
}

// ──────────────────────────────────────────────────────────────────
// Ordenação das paradas a partir da `origem` (loja):
// 1) vizinho mais próximo (nearest neighbor)
// 2) melhoria 2-opt (desfaz cruzamentos)
// Rota ABERTA: começa na loja e NÃO volta pra ela.
// `paradas`: [{ lat, lng, ... }]. Retorna nova lista reordenada.
// ──────────────────────────────────────────────────────────────────
function ordenar(origem, paradas) {
    const n = paradas.length;
    if (n <= 1) return paradas.slice();

    // 1) Nearest neighbor
    const rest = paradas.map((_, i) => i);
    const ordem = [];
    let atual = origem;
    while (rest.length) {
        let best = 0, bestD = Infinity;
        for (let k = 0; k < rest.length; k++) {
            const d = haversine(atual, paradas[rest[k]]);
            if (d < bestD) { bestD = d; best = k; }
        }
        const idx = rest.splice(best, 1)[0];
        ordem.push(idx);
        atual = paradas[idx];
    }

    // 2) 2-opt
    function custo(r) {
        let c = haversine(origem, paradas[r[0]]);
        for (let i = 0; i < r.length - 1; i++) c += haversine(paradas[r[i]], paradas[r[i + 1]]);
        return c;
    }
    let rota = ordem;
    let cAtual = custo(rota);
    let melhorou = true;
    let guarda = 0;
    while (melhorou && guarda++ < 50) {
        melhorou = false;
        for (let i = 0; i < rota.length - 1; i++) {
            for (let j = i + 1; j < rota.length; j++) {
                const nova = rota.slice(0, i)
                    .concat(rota.slice(i, j + 1).reverse(), rota.slice(j + 1));
                const cNova = custo(nova);
                if (cNova + 1e-9 < cAtual) { rota = nova; cAtual = cNova; melhorou = true; }
            }
        }
    }

    return rota.map(i => paradas[i]);
}

// Distância total de uma rota aberta origem→paradas (km), pra exibir no painel.
function distanciaTotal(origem, paradasOrdenadas) {
    if (!paradasOrdenadas.length) return 0;
    let d = haversine(origem, paradasOrdenadas[0]);
    for (let i = 0; i < paradasOrdenadas.length - 1; i++) {
        d += haversine(paradasOrdenadas[i], paradasOrdenadas[i + 1]);
    }
    return d;
}

module.exports = { haversine, agrupar, centro, ordenar, distanciaTotal };
