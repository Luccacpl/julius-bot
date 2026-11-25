# Monitor de preços pet

Coleta catálogos reais da Cobasi, Petz, Petlove e Alfaderma, guarda o histórico de preços em SQLite e compara produtos equivalentes no dashboard.

A busca da interface acontece somente na base já coletada.

## Viabilidade

| Loja | Mecanismo usado | Acesso observado |
| --- | --- | --- |
| Cobasi | API pública de catálogo da VTEX (`/api/catalog_system/pub/category/tree` e `/products/search`) | Responde para cliente HTTP. A paginação vem no cabeçalho `resources`. Categorias grandes são divididas por marca porque a busca corta por volta de 2.500 itens. |
| Petz | JSON do próprio catálogo (`/api/v3/public/menu/departments` e `?json=products&page=`) dentro de uma janela real do Edge | Cliente HTTP e Edge headless recebem `403 Access Denied` da Akamai. A janela visível carrega o site. Não há tentativa de contornar esse bloqueio. |
| Petlove | HTML com JSON-LD nas categorias e a API de preço que a página usa (`/leopardo/api/product-prices`) | Cliente HTTP e Edge headless caem no desafio da Cloudflare. A janela visível passa pela verificação normal do navegador. Preço de Clube Petlove e assinatura não entra na comparação. |
| Alfaderma | API pública usada pela loja (`/api/public/products` e `/api/public/products/filters`) | Responde para cliente HTTP, com paginação e filtro por categoria. O catálogo é de dermatologia veterinária. |

A coleta padrão da Cobasi fica nos departamentos de animais. Casa, jardim e piscina aparecem no seletor e só entram se forem marcados.

## Como executar

É preciso Node.js e o Microsoft Edge instalado.

```bash
npm run setup
npm run dev
```

- Interface: http://localhost:5173
- API: http://localhost:3333

Para testar um scraper isolado:

```bash
npm run scrape -- --store Cobasi --category 1001437 --max-pages 2
npm run scrape -- --store Petz --category /cachorro/racao/racao-seca --max-pages 1
npm run scrape -- --store Petlove --category /cachorro/racoes/racao-seca --max-pages 1
```

Sem `--max-pages`, a categoria inteira é percorrida. Sem `--category`, entram todas as categorias pet da loja. A pausa mínima entre requisições é 400 ms; o padrão é 800 ms.

Durante Petz e Petlove, deixe a janela do Edge aberta até o fim da loja.

## O que a base guarda

Cada SKU ou variação vira um produto. Uma embalagem de 3 kg não é o mesmo registro de uma de 10 kg. Toda coleta acrescenta uma linha em `PriceHistory`; o preço atual do produto é atualizado e o histórico permanece.

A correspondência automática exige marca, espécie, peso ou volume, quantidade e sabor compatíveis. Casos apenas parecidos ficam na tela de revisão para confirmar ou rejeitar. Uma rejeição não volta na próxima atualização.

## Variáveis

Veja `.env.example`. `BROWSER_HEADLESS=true` não é recomendado: os bloqueios observados acontecem justamente no modo headless.
