# Segurança

O jogo roda inteiro no navegador: não há servidor, contas nem coleta de dados. Ele guarda só duas preferências no `localStorage` do próprio navegador: o recorde e o som mudo.

Não há telemetria implementada pelo jogo. A página carrega fontes do Google Fonts, gerando requisições a
um serviço externo; sem rede, usa fontes de reserva. Os ganchos `window.__game` são ferramentas locais de
teste: não dão acesso a contas, servidores ou dados de outros jogadores.

## Como relatar uma vulnerabilidade

Não abra uma issue pública. Use o relato privado do GitHub (aba **Security → Report a vulnerability** deste repositório) ou escreva para contato.jesusoliveira@gmail.com, com a descrição e os passos para reproduzir.

## Versões cobertas

Só a versão mais recente da branch `main`, que é a publicada no GitHub Pages.
