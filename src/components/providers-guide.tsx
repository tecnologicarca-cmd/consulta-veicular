"use client";

interface ProviderCardProps {
  name: string;
  badge: string;
  badgeType: "recommended" | "popular" | "official" | "enterprise";
  website: string;
  highlight: string;
  deliveredData: string[];
  bestFor: string;
  billingModel: string;
}

const alternativeProviders: ProviderCardProps[] = [
  {
    name: "APIBrasil (Atualmente Integrada)",
    badge: "Plataforma Base",
    badgeType: "popular",
    website: "apibrasil.com.br",
    highlight: "Excelente custo por requisição para protótipos e sistemas que precisam de flexibilidade pré-paga.",
    deliveredData: [
      "Dados cadastrais básicos (marca, modelo, chassi, motor, cor, ano)",
      "Multas estaduais (Detrans participantes)",
      "Alerta de restrição de roubo e furto",
      "Histórico preliminar em leilões cadastrados",
      "Recall pendente por montadora",
    ],
    bestFor: "Desenvolvedores, automações, chatbots e conferência rápida de frotas.",
    billingModel: "Recarga pré-paga em créditos com pagamento por consulta (sem mensalidade obrigatória).",
  },
  {
    name: "Olho no Carro (Carcheck B2B)",
    badge: "Mais Completa para Laudo",
    badgeType: "recommended",
    website: "olhonocarro.com.br",
    highlight: "A mais profunda do Brasil para histórico cautelar, fotos reais de pátio de leilão e análise de batidas/sinistros.",
    deliveredData: [
      "Histórico de leilão com FOTOS REAIS do veículo no pátio",
      "Registro de sinistro/batidas (pequena, média e grande monta com indenização)",
      "Histórico completo de proprietários anteriores (quantidade de donos e tempo de permanência)",
      "Alerta de KM adulterada registrada em vistorias credenciadas",
      "Bloqueio judicial Renajud, gravame financeiro (alienação fiduciária)",
      "Aceitação em companhias de seguros e índice de desvalorização",
    ],
    bestFor: "Revendas, lojas de seminovos, compradores exigentes, seguradoras e vistorias cautelares.",
    billingModel: "Pacotes empresariais B2B por consulta ou planos por volume com relatório em PDF whitelabel.",
  },
  {
    name: "WebXcar (Placa FIPE API)",
    badge: "Visual & Imagens Oficiais",
    badgeType: "popular",
    website: "webxcar.com.br",
    highlight: "API moderna com retorno rápido em JSON que entrega fotos oficiais da montadora e dados cadastrais limpos.",
    deliveredData: [
      "Dados de montadora pela placa ou chassi",
      "Código FIPE e valor histórico com FOTOS OFICIAIS em alta resolução do catálogo",
      "Cidade e UF de emplacamento e histórico de padrão antigo/Mercosul",
      "Filtros ágeis para cotações e portais de classificados",
    ],
    bestFor: "Portais de anúncios de veículos, integradores de CRM automotivo e cotações de seguros.",
    billingModel: "Planos mensais com limites de requisições por segundo e excelente estabilidade de CDN.",
  },
  {
    name: "Direct Data (DirectD - Consulta Veicular v3)",
    badge: "Solução Corporativa / Frotas",
    badgeType: "enterprise",
    website: "directd.com.br",
    highlight: "Infraestrutura corporativa robusta utilizada por bancos, financeiras e grandes locadoras de veículos.",
    deliveredData: [
      "CRLV Digital e dados de emissão de ATPV-e (intenção de venda)",
      "Detalhamento de débitos (IPVA, DPVAT, licenciamento e multas com linha digitável/guia)",
      "Gravames ativos no Sistema Nacional de Gravames (SNG)",
      "Indicadores de sinistro, alarme, bloqueio administrativo e comunicação de venda ativa",
      "Identificação de faturamento (documento faturado e pessoa física/jurídica)",
    ],
    bestFor: "Financeiras de crédito auto, despachantes, locadoras de veículos e grandes gestores de frota.",
    billingModel: "Contrato empresarial pós-pago com SLA garantido e suporte técnico dedicado.",
  },
  {
    name: "Infocar / Checkauto",
    badge: "Pioneira em Laudos",
    badgeType: "enterprise",
    website: "infocar.com.br",
    highlight: "Tradicional no ecossistema de perícia e laudo de transferência veicular em todo o território nacional.",
    deliveredData: [
      "Certificado e histórico de leilão com cruzamento de bases judiciais",
      "Recall oficial com status de atendimento da campanha",
      "Índice de perda total (PT) e recuperação por seguradoras",
      "Verificação de restrições tributárias e alienações",
    ],
    bestFor: "Empresas de vistoria credenciadas (ECVs) e concessionárias de grande porte.",
    billingModel: "Contratação corporativa com API REST e relatórios homologados.",
  },
  {
    name: "SERPRO Conecta (WSDenatran / Senatran)",
    badge: "Governo Federal (Oficial)",
    badgeType: "official",
    website: "loja.serpro.gov.br",
    highlight: "A fonte primária oficial do Governo Federal brasileiro com acesso direto à Base Índice Nacional (BIN).",
    deliveredData: [
      "Base Índice Nacional (BIN) oficial e cadastro do primeiro emplacamento",
      "Registro de veículos em estoque (RENAVE)",
      "Multas interestaduais registradas no sistema RENAINF",
      "Restrições administrativas e de trânsito em âmbito federal",
    ],
    bestFor: "Órgãos públicos, bancos federais, montadoras e empresas previamente credenciadas na Senatran.",
    billingModel: "Exige credenciamento formal na Senatran, CNPJ e certificado digital ICP-Brasil com tarifação oficial Serpro.",
  },
];

export default function ProvidersGuide() {
  return (
    <section className="providers-guide-section" id="guia-provedores">
      <div className="section-title-row">
        <div>
          <div className="section-kicker">PANORAMA DO MERCADO BRASILEIRO</div>
          <h2>Comparativo de Fontes & APIs Veiculares</h2>
          <p>
            Análise detalhada para responder: <strong>qual provedor entrega mais dados para o seu projeto?</strong>
          </p>
        </div>
        <div className="guide-header-tip">
          <span>💡 Dica de Integração</span>
          <p>
            Você pode manter a <strong>APIBrasil</strong> configurada nesta aplicação e adicionar provedores especializados
            como o <strong>Olho no Carro</strong> para relatórios de laudo ou <strong>Direct Data</strong> para débitos de IPVA.
          </p>
        </div>
      </div>

      <div className="smart-architecture-banner">
        <div className="banner-icon">⚡</div>
        <div className="banner-copy">
          <strong>Como nossa plataforma já economiza seu saldo:</strong>
          <p>
            Em vez de pagar à APIBrasil pelo endpoint FIPE em cada consulta, nosso motor inteligente pega a marca, modelo e ano
            retornados pela consulta básica e resolve <strong>gratuitamente na Tabela FIPE oficial da Parallelum</strong>.
            Assim você só gasta com multas, leilão e roubo/furto se realmente precisar!
          </p>
        </div>
      </div>

      <div className="providers-cards-grid">
        {alternativeProviders.map((provider) => (
          <article className="provider-review-card" key={provider.name}>
            <div className="provider-card-head">
              <div>
                <h3>{provider.name}</h3>
                <a
                  href={`https://${provider.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="provider-link"
                >
                  {provider.website} ↗
                </a>
              </div>
              <span className={`provider-badge badge-${provider.badgeType}`}>{provider.badge}</span>
            </div>

            <p className="provider-highlight">{provider.highlight}</p>

            <div className="provider-data-box">
              <span className="data-box-title">O QUE ESTA FONTE ENTREGA:</span>
              <ul className="provider-data-list">
                {provider.deliveredData.map((item, idx) => (
                  <li key={idx}>
                    <span className="check-bullet">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="provider-meta-row">
              <div className="meta-item">
                <span className="meta-label">MELHOR PARA:</span>
                <strong>{provider.bestFor}</strong>
              </div>
              <div className="meta-item">
                <span className="meta-label">MODELO DE COBRANÇA:</span>
                <small>{provider.billingModel}</small>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="provider-conclusion-card">
        <div className="conclusion-icon">🎯</div>
        <div className="conclusion-copy">
          <strong>Recomendação Prática para o seu Projeto:</strong>
          <ul>
            <li>
              <strong>Se você quer dados baratos por consulta:</strong> Mantenha a <strong>APIBrasil</strong> configurada na aba
              Configurações. Ela oferece o menor valor de recarga mínima e funciona muito bem para dados básicos e débitos.
            </li>
            <li>
              <strong>Se você quer laudo completo com fotos de leilão e sinistro:</strong> Contrate a API da <strong>Olho no Carro</strong>.
              Nenhum outro provedor aberto no Brasil entrega as fotos originais do pátio do leilão e histórico de batidas com tanta precisão.
            </li>
            <li>
              <strong>Se você quer fotos oficiais e precificação de estoque:</strong> A <strong>WebXcar</strong> é a melhor opção para
              exibir imagens limpas do modelo e dados estruturados.
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
