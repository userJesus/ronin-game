# Créditos e componentes de terceiros

O código e a arte do projeto são distribuídos sob a [licença MIT](LICENSE). Componentes de terceiros
conservam seus próprios avisos e licenças.

| Componente | Uso | Origem / licença |
|---|---|---|
| three.js | Renderização WebGL2; incluído no JavaScript de produção | [Projeto](https://github.com/mrdoob/three.js) · [MIT, cópia local](public/licenses/three-MIT.txt) |
| Yuji Boku | Contorno do glifo 雨 usado no símbolo em `src/ui/title/art.ts` e nas peças geradas por `npm run brand` | Copyright 2021 The Yuji Project Authors · [origem](https://github.com/Kinutafontfactory/Yuji) · [SIL OFL 1.1, cópia local](public/licenses/YujiBoku-OFL.txt) |
| DotGothic16 | Fonte da interface, carregada pelo Google Fonts | [Origem e OFL](https://github.com/google/fonts/tree/main/ofl/dotgothic16) |
| Shippori Mincho B1 | Fonte dos títulos, carregada pelo Google Fonts | [Origem e OFL](https://github.com/google/fonts/tree/main/ofl/shipporiminchob1) |
| Contributor Covenant 2.1 | Base do código de conduta | [Origem](https://www.contributor-covenant.org/version/2/1/code_of_conduct.html) |

As fontes da interface não são vendidas nem incluídas como arquivos de fonte neste repositório. Sem acesso
ao Google Fonts, o jogo usa as fontes de reserva do CSS. O download delas faz requisições a esse serviço externo.

As folhas em [`assets-src/`](assets-src/) foram geradas com ChatGPT (gpt-image), conforme o registro
de [desenvolvimento](docs/processo.md). Os originais são preservados; os sprites e recortes são produzidos
pelos scripts do projeto. O áudio, as texturas do cenário e os efeitos são procedurais.

As ferramentas de desenvolvimento e suas versões exatas estão em [`package-lock.json`](package-lock.json).
Os avisos instalados acompanham cada pacote em `node_modules`. As cópias de avisos em `public/licenses/`
também são copiadas pelo Vite para os builds. Ao distribuir apenas o HTML de arquivo único, mantenha os
créditos e as licenças junto dele.
