# Araquari Cestas 2.0 — Design System

Sistema visual do app do cliente e do painel. **Regra inegociável: zero emoji nativo** em
qualquer superfície — todo ícone é SVG Lucide (vendorizado localmente, sem CDN). Texto e
contraste seguem WCAG AA. Motion é parte central do app do cliente (admin e entregador ficam
limpos e leves, sem animação pesada).

## Cores (tokens CSS em `:root`)

| Token | Hex | Uso |
|---|---|---|
| `--bg` | `#0B0F0E` | Background |
| `--bg2` / `--card` | `#151A18` | Surface |
| `--bg3` / `--card2` | `#1E2421` | Surface Elevated |
| `--border` | `#2A322E` | Bordas |
| `--text` | `#F9FAFB` | Texto primário |
| `--text2` | `#A1A7A3` | Texto secundário |
| `--text3` | `#6B7280` | Texto inativo |
| `--green` | `#22C55E` | Cesta X |
| `--orange` | `#F59E0B` | Cesta Confort / botão primário |
| `--yellow` | `#EAB308` | Cesta Plus |
| `--success` | `#10B981` | Sucesso |
| `--red` | `#EF4444` | Erro |
| `--blue` | `#3B82F6` | Info |

- **Botão primário**: fundo laranja `#F59E0B` com **texto escuro** (`--on-primary: #1A1200`) para contraste AA.
- As cestas se diferenciam por **nome + tag + cor** (não só cor): X (verde), Confort (laranja, "POPULAR"), Plus (amarelo, "PREMIUM").

## Tipografia — Inter (Google Fonts)

| Papel | Tamanho/linha | Peso |
|---|---|---|
| Título principal (H1) | 28 / 34 | 700 |
| Título secundário (H2) | 22 / 28 | 700 |
| Título de card | 18 / 24 | 700 |
| Subtítulo | 16 / 24 | 500 |
| Corpo | 16 / 24 | 400 |
| Preço destaque | 32 / 38 | 800 |
| Legenda | 14 / 20 | 400 |

Nada essencial abaixo de 14px.

## Espaçamento e raios

- Escala de espaçamento: **4 / 8 / 12 / 16 / 20 / 24 / 32**.
- Raios: cards **20** (`--radius-card`), botões **16** (`--radius`), campos **12** (`--radius-field`), painéis inferiores **28** (`--radius-xl`).
- Área de toque mínima **48×48**.

## Ícones — Lucide (local, sem CDN)

- Vendorizados em `public/assets/lucide-icons.js` (lucide-static v0.544.0, ISC). Traço 2px, tamanhos 20 e 24.
- Uso em JS: `IC('nome', tamanho)`. Uso em HTML estático: `<span data-ic="nome" data-sz="20"></span>` (hidratado no load).
- Conjunto usado: `shopping-basket, map, heart, hand-heart, arrow-left-right, truck, map-pin, phone, user,
  check-circle, clock, search, locate-fixed, satellite, chevron-left/right/up/down, minus, plus,
  share-2, download, file-text, copy, package, gift, crown, credit-card, store, settings, save,
  trash-2, zap, bar-chart, inbox, image, refresh-cw, home, star, alert-triangle, x, check,
  arrow-left/right, info, volume-x`.
- As 3 cestas usam o ícone `shopping-basket` tintado na cor de cada uma.
- **Campo "Emoji" das cestas virou "Ícone"**: no painel é um seletor de ícones Lucide; no banco a coluna
  `emoji` passa a guardar o **nome** do ícone (migração `migration-010-cesta-icone.sql`, que também
  alarga a coluna e limpa emojis das tags).

## Motion (só app do cliente; `transform`/`opacity`; respeita `prefers-reduced-motion`)

| Interação | Especificação |
|---|---|
| Entrada dos cards | stagger 40ms, 220ms ease-out (`cardIn`) |
| Painéis / bottom sheets | 280ms `cubic-bezier(0.22,1,0.36,1)` |
| Toque em botão/card | `scale(0.98)`, 120ms ease-out |
| Transição entre telas | 240ms ease-in-out (slide + fade) |
| Timeline do pedido | cada etapa acende 260ms ease-out; linha preenche progressivamente |
| Comprovante | 220ms ease-out (fade + leve subida) |
| Confirmações | check animado (draw do traço) |
| Carregando | skeleton/shimmer nas cestas e no mapa |
| Preço / quantidade | transição suave (bump 280ms) |

Todas as animações são desligadas sob `@media (prefers-reduced-motion: reduce)`.

## O que NÃO existe (decisões de escopo)

- Sem sininho de notificações e sem barra "Entregar em" na home (o fluxo de endereço continua como hoje).
- Nada foi removido: botão de imprevisto (WhatsApp), Baixar/Compartilhar comprovante, Doação Livre
  (valor livre), preço Pix, quantidade, lista completa de itens, Rastreio, Dúvidas e todos os campos de endereço permanecem.
