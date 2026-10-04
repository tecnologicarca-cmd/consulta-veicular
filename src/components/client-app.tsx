"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  convertPlateFormat,
  getPlateFormat,
  isValidPlate,
  isValidRenavam,
  normalizePlate,
  normalizeRenavam,
  optionalServices,
  type LookupType,
  type OptionalService,
  type PlateFormatSelection,
  type ServiceSelection,
} from "@/lib/vehicles";
import { formatCentsToReal } from "@/lib/pix";

interface ServiceOption {
  key: OptionalService;
  name: string;
  description: string;
  costCents: number;
  icon: IconName;
}

const serviceOptions: ServiceOption[] = [
  { key: "fipe", name: "Tabela FIPE", description: "Valor de mercado e código FIPE.", costCents: 6, icon: "chart" },
  { key: "multas", name: "Multas", description: "Infrações e débitos de trânsito.", costCents: 345, icon: "ticket" },
  { key: "roubo", name: "Roubo e Furto", description: "Ocorrências de roubo ou furto.", costCents: 386, icon: "shield" },
  { key: "leilao", name: "Leilão", description: "Histórico em bases de leilão.", costCents: 2112, icon: "auction" },
  { key: "recall", name: "Recall", description: "Campanhas pendentes da montadora.", costCents: 62, icon: "wrench" },
  { key: "gravame", name: "Gravame", description: "Alienacao fiduciaria e financiamento.", costCents: 271, icon: "lock" },
  { key: "csv", name: "CSV Completa", description: "RENAINF + RENAJUD + BIN + recall em uma chamada.", costCents: 400, icon: "doc" },
  { key: "debitos", name: "Debitos (boleto)", description: "Debitos veiculares com boleto.", costCents: 1200, icon: "boleto" },
  { key: "crlv", name: "Documento CRLV", description: "Emissao do documento CRLV em PDF.", costCents: 1400, icon: "doc" },
  { key: "score", name: "Score CPF", description: "Score de credito Acerta Essencial.", costCents: 34, icon: "score" },
];

interface Pricing {
  costCents: number;
  markupCents: number;
  fixedFeeCents: number;
  totalCents: number;
  markupPercent: number;
  appliedMinimum: boolean;
}

interface Order {
  id: number;
  txId: string;
  pixCode: string;
  amountCents: number;
  expiresAt: string;
  provider: string;
  qrCodeBase64: string | null;
}

interface OrderRecord {
  id: number;
  lookupType: LookupType;
  lookupValue: string;
  services: ServiceSelection;
  costCents: number;
  priceCents: number;
  status: "pending" | "paid" | "confirmed" | "cancelled" | "expired";
  pixCode: string | null;
  pixTxId: string | null;
  pixProvider: string;
  qrCodeBase64: string | null;
  result: unknown;
  createdAt: string;
  paidAt: string | null;
  confirmedAt: string | null;
  expiresAt: string | null;
}

export default function ClientApp() {
  const [tab, setTab] = useState<"consulta" | "historico">("consulta");
  const [lookupType, setLookupType] = useState<LookupType>("placa");
  const [lookupText, setLookupText] = useState("");
  const [platePreference, setPlatePreference] = useState<PlateFormatSelection>("auto");
  const [services, setServices] = useState<ServiceSelection>({
    fipe: false,
    multas: false,
    roubo: false,
    leilao: false,
    recall: false,
    gravame: false,
    csv: false,
    debitos: false,
    crlv: false,
    score: false,
  });
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [activeOrder, setActiveOrder] = useState<OrderRecord | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [polling, setPolling] = useState(false);

  const lookupValue =
    lookupType === "renavam" ? normalizeRenavam(lookupText) : normalizePlate(lookupText);
  const isValid =
    lookupValue.length > 0 &&
    (lookupType === "renavam" ? isValidRenavam(lookupValue) : isValidPlate(lookupValue));

  // Recalcula o preço no servidor com os serviços ATUAIS
  const refreshPricing = useCallback(async (selected: ServiceSelection) => {
    try {
      const response = await fetch("/api/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ services: selected }),
        cache: "no-store",
      });
      if (response.ok) {
        const data = (await response.json()) as { pricing: Pricing };
        setPricing(data.pricing);
      }
    } catch {
      // silencioso
    }
  }, []);

  const refreshOrders = useCallback(async () => {
    try {
      const response = await fetch("/api/orders", { cache: "no-store" });
      if (response.ok) {
        const data = (await response.json()) as { items?: OrderRecord[] };
        setOrders(Array.isArray(data.items) ? data.items : []);
      }
    } catch {
      // silencioso
    }
  }, []);

  // Carrega pedidos uma vez
  useEffect(() => {
    void refreshOrders();
  }, [refreshOrders]);

  // Recalcula o preço sempre que um serviço é marcado/desmarcado
  useEffect(() => {
    void refreshPricing(services);
  }, [services, refreshPricing]);

  function updateLookup(value: string) {
    const separators = /([\s,;]+)/;
    setLookupText(
      value
        .split(separators)
        .map((part) =>
          /^[\s,;]+$/.test(part)
            ? part
            : lookupType === "renavam"
              ? normalizeRenavam(part)
              : displayPlate(part, platePreference),
        )
        .join(""),
    );
    setOrder(null);
    setActiveOrder(null);
    setError("");
  }

  function changeLookupType(next: LookupType) {
    setLookupType(next);
    setLookupText("");
    setOrder(null);
    setActiveOrder(null);
    setError("");
  }

  function changePlateFormat(format: PlateFormatSelection) {
    setPlatePreference(format);
    if (lookupType !== "placa") return;
    const separators = /([\s,;]+)/;
    setLookupText(
      lookupText
        .split(separators)
        .map((part) => (/^[\s,;]+$/.test(part) ? part : displayPlate(part, format)))
        .join(""),
    );
  }

  function toggleService(key: OptionalService) {
    setServices((current) => ({ ...current, [key]: !current[key] }));
    setOrder(null);
    setActiveOrder(null);
    setError("");
  }

  async function generatePix(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValid || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lookupType,
          lookupValue,
          services: buildServices(),
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        data?: Order;
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error || "Não foi possível gerar o PIX.");
      }
      setOrder(payload.data);
      if (payload.data.provider === "mercadopago") {
        setNotice("PIX gerado! Assim que o pagamento for aprovado, a consulta é liberada automaticamente.");
      } else {
        setNotice("PIX gerado! Efetue o pagamento e clique em “Já paguei”.");
      }
      startPolling(payload.data.id, payload.data.provider);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao gerar PIX.");
    } finally {
      setBusy(false);
    }
  }

  function buildServices(): ServiceSelection {
    return {
      fipe: services.fipe,
      multas: services.multas,
      roubo: services.roubo,
      leilao: services.leilao,
      recall: services.recall,
      gravame: services.gravame,
      csv: services.csv,
      debitos: services.debitos,
      crlv: services.crlv,
      score: services.score,
    };
  }

  function startPolling(orderId: number, provider?: string) {
    setPolling(true);
    const interval = window.setInterval(async () => {
      try {
        const isAutomatic = provider === "mercadopago";
        const response = await fetch(`/api/orders/${orderId}`, {
          cache: "no-store",
          method: isAutomatic ? "PATCH" : "GET",
          headers: isAutomatic ? { "Content-Type": "application/json" } : undefined,
          body: isAutomatic ? JSON.stringify({ action: "sync" }) : undefined,
        });
        if (response.ok) {
          const data = (await response.json()) as { data: OrderRecord };
          setActiveOrder(data.data);
          if (data.data.status === "confirmed" || data.data.status === "cancelled") {
            window.clearInterval(interval);
            setPolling(false);
            void refreshOrders();
          }
        }
      } catch {
        window.clearInterval(interval);
        setPolling(false);
      }
    }, 4_000);
  }

  async function reportPayment() {
    if (!order) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "report_payment" }),
      });
      const payload = (await response.json()) as { ok?: boolean; data?: OrderRecord };
      if (payload.ok && payload.data) {
        setActiveOrder(payload.data);
        setNotice("Pagamento informado! Aguardando confirmação do administrador.");
        startPolling(payload.data.id);
      }
    } catch {
      setError("Falha ao informar pagamento.");
    } finally {
      setBusy(false);
    }
  }

  async function copyPix() {
    if (!order?.pixCode) return;
    try {
      await navigator.clipboard.writeText(order.pixCode);
      setNotice("Código PIX copiado!");
    } catch {
      setError("Não foi possível copiar. Selecione o código manualmente.");
    }
  }

  function viewOrder(item: OrderRecord) {
    setActiveOrder(item);
    setTab("consulta");
    if (item.pixCode && item.status === "pending") {
      setOrder({ id: item.id, txId: item.pixTxId ?? "", pixCode: item.pixCode, amountCents: item.priceCents, expiresAt: item.expiresAt ?? "", provider: item.pixProvider ?? "manual", qrCodeBase64: item.qrCodeBase64 ?? null });
    }
  }

  const total = pricing?.totalCents ?? 0;

  return (
    <div className="client-shell">
      <aside className="client-sidebar">
        <div className="client-brand">
          <span className="client-brand-mark"><Icon name="car" size={20} /></span>
          <span className="client-brand-text">arca<span>.</span><small>CONSULTAS</small></span>
        </div>
        <nav className="client-nav">
          <button className={tab === "consulta" ? "active" : ""} onClick={() => setTab("consulta")}><Icon name="search" />Consulta</button>
          <button className={tab === "historico" ? "active" : ""} onClick={() => setTab("historico")}><Icon name="history" />Histórico</button>
        </nav>
        <div className="client-sidebar-footer">
          <div className="client-secure"><Icon name="lock" size={14} /><span>Pagamento via PIX</span></div>
          <div className="client-secure"><Icon name="shield" size={14} /><span>Dados liberados após confirmação</span></div>
        </div>
      </aside>

      <main className="client-main">
        <header className="client-topbar">
          <div className="client-title"><Icon name={lookupType === "placa" ? "plate" : "search"} size={16} /><strong>{lookupType === "placa" ? "Consulta por Placa" : "Consulta por RENAVAM"}</strong></div>
          <div className="client-badge"><Icon name="pix" size={16} />PIX</div>
        </header>

        <div className="client-content">
          {tab === "consulta" ? (
            <>
              <section className="client-panel">
                <h1>Consulta Veicular</h1>
                <p>Selecione os serviços desejados, gere o PIX e receba o relatório após a confirmação do pagamento.</p>

                <div className="client-type-tabs">
                  <button className={lookupType === "placa" ? "active" : ""} onClick={() => changeLookupType("placa")}>Placa</button>
                  <button className={lookupType === "renavam" ? "active" : ""} onClick={() => changeLookupType("renavam")}>RENAVAM</button>
                </div>

                <form onSubmit={(event) => void generatePix(event)}>
                  <label className="client-field-label" htmlFor="client-lookup">
                    {lookupType === "placa" ? "PLACA (ANTIGA OU MERCOSUL)" : "CÓDIGO RENAVAM"}
                  </label>
                  <div className="client-plate-box">
                    <div className="client-country">{lookupType === "placa" ? "BR" : "REN"}</div>
                    <input
                      id="client-lookup"
                      className="client-input"
                      value={lookupText}
                      onChange={(event) => updateLookup(event.currentTarget.value)}
                      placeholder={lookupType === "placa" ? "ABC1D23" : "01234567890"}
                      maxLength={lookupType === "placa" ? 8 : 11}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>

                  <div className="client-services">
                    {serviceOptions.map((option) => (
                      <label key={option.key} className={`client-service ${services[option.key] ? "selected" : ""}`}>
                        <input
                          type="checkbox"
                          checked={services[option.key]}
                          onChange={() => toggleService(option.key)}
                        />
                        <span className="client-service-icon"><Icon name={option.icon} size={16} /></span>
                        <span className="client-service-copy">
                          <strong>{option.name}</strong>
                          <small>{option.description}</small>
                        </span>
                        <span className="client-service-price">{formatCentsToReal(option.costCents)}</span>
                        <span className="client-service-check"><Icon name="check" size={11} /></span>
                      </label>
                    ))}
                  </div>

                  {pricing && (
                    <div className="client-price-summary">
                      <div className="client-price-row"><span>Custo dos serviços</span><strong>{formatCentsToReal(pricing.costCents)}</strong></div>
                      <div className="client-price-row"><span>Taxa de serviço ({pricing.markupPercent}%)</span><strong>{formatCentsToReal(pricing.markupCents)}</strong></div>
                      {pricing.fixedFeeCents > 0 && <div className="client-price-row"><span>Taxa fixa</span><strong>{formatCentsToReal(pricing.fixedFeeCents)}</strong></div>}
                      <div className="client-price-row total"><span>Total a pagar</span><strong>{formatCentsToReal(total)}</strong></div>
                      {pricing.appliedMinimum && <small className="client-price-min">* Valor mínimo de consulta aplicado.</small>}
                    </div>
                  )}

                  <button className="client-pix-button" type="submit" disabled={!isValid || busy}>
                    <Icon name="pix" size={18} />
                    {busy ? "Gerando PIX…" : "Gerar PIX e consultar"}
                  </button>
                  {!isValid && lookupValue.length > 0 && <p className="client-error">Verifique o {lookupType === "placa" ? "formato da placa" : "RENAVAM informado"}.</p>}
                </form>
              </section>

              {order && !activeOrder && (
                <section className="client-panel pix-panel">
                  <h2><Icon name="pix" size={18} /> Pagamento via PIX</h2>
                  <p className="pix-amount">{formatCentsToReal(order.amountCents)}</p>
                  <div className="pix-qr">
                    <QRCodeSVG value={order.pixCode} size={200} level="M" />
                  </div>
                  <p className="pix-label">Código copia e cola</p>
                  <div className="pix-code-box">
                    <code>{order.pixCode}</code>
                    <button type="button" className="pix-copy" onClick={() => void copyPix()}><Icon name="check" size={14} />Copiar</button>
                  </div>
                  <div className="pix-actions">
                    {order.provider === "mercadopago" ? (
                      <div className="pix-auto-note"><span className="spinner" />Aguardando confirmação automática do pagamento…</div>
                    ) : (
                      <button type="button" className="client-pix-button confirm" onClick={() => void reportPayment()} disabled={busy}><Icon name="check" size={17} />Já paguei</button>
                    )}
                  </div>
                  <p className="pix-expiry">Expira em {new Date(order.expiresAt).toLocaleTimeString("pt-BR")}</p>
                </section>
              )}

              {activeOrder && (
                <section className="client-panel result-panel">
                  {activeOrder.status === "pending" && (
                    <div className="client-status waiting"><span className="spinner" />Aguardando pagamento…</div>
                  )}
                  {activeOrder.status === "paid" && (
                    <div className="client-status waiting"><span className="spinner" />Pagamento informado. Aguardando confirmação do administrador…</div>
                  )}
                  {activeOrder.status === "confirmed" && (
                    <div className="client-status success"><Icon name="check" size={18} />Pagamento confirmado! Consulta liberada.</div>
                  )}
                  {activeOrder.status === "cancelled" && (
                    <div className="client-status error"><Icon name="alert" size={18} />Pedido cancelado.</div>
                  )}
                  {activeOrder.status === "confirmed" && activeOrder.result ? (
                    <OrderResult result={activeOrder.result} lookupValue={activeOrder.lookupValue} lookupType={activeOrder.lookupType} />
                  ) : (
                    <p className="client-note">O resultado será exibido aqui após a confirmação do pagamento.</p>
                  )}
                </section>
              )}

              {error && <div className="client-alert error"><Icon name="alert" size={16} />{error}</div>}
              {notice && <div className="client-alert info"><Icon name="check" size={16} />{notice}</div>}
            </>
          ) : (
            <section className="client-panel">
              <h1>Meu Histórico</h1>
              <p>Consultas solicitadas por você neste navegador.</p>
              {orders.length === 0 ? (
                <div className="client-empty"><Icon name="history" size={24} /><p>Nenhuma consulta solicitada ainda.</p></div>
              ) : (
                <div className="client-history-list">
                  {orders.map((item) => (
                    <button className="client-history-row" key={item.id} onClick={() => viewOrder(item)}>
                      <div className="client-history-icon"><Icon name={item.lookupType === "placa" ? "car" : "search"} size={16} /></div>
                      <div className="client-history-main"><strong>{item.lookupValue}</strong><span>{new Date(item.createdAt).toLocaleString("pt-BR")} · {serviceSummary(item.services)}</span></div>
                      <span className={`client-history-status status-${item.status}`}>{statusLabel(item.status)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function OrderResult({ result, lookupValue, lookupType }: { result: unknown; lookupValue: string; lookupType: LookupType }) {
  const report = result as {
    vehicle?: Record<string, unknown>;
    fipe?: { valor?: string | null; codigoFipe?: string | null; modelo?: string | null; anoModelo?: string | null; combustivel?: string | null; mesReferencia?: string | null } | null;
    multas?: Array<{ descricao?: string; valorDevido?: number | null; valor?: number | null; dataHora?: string | null; local?: string | null }>;
    totalMultas?: number;
    sources?: string[];
    rouboFurto?: { headline?: string | null; state?: string } | null;
    leilao?: { headline?: string | null; state?: string } | null;
    recall?: { headline?: string | null; state?: string } | null;
    gravame?: { headline?: string | null; state?: string } | null;
    csvCompleta?: {
      bin?: { marcaModelo?: string | null; chassi?: string | null; renavam?: string | null; municipio?: string | null; uf?: string | null; situacao?: string | null; proprietario?: { documento?: string | null; nome?: string | null } | null } | null;
      restricoes?: Array<{ mensagem: string }>;
      renajud?: { quantidade?: string | null; ocorrencias?: Array<{ processo?: string | null; orgao?: string | null; tribunal?: string | null; data?: string | null; restricoes?: string | null }> };
      renainf?: { quantidade?: string | null; ocorrencias?: Array<{ descricao?: string | null; valor?: string | null; local?: string | null; data?: string | null }> };
      proprietario?: { documento?: string | null; nome?: string | null } | null;
    } | null;
    debitos?: { status?: string | null; pdf?: string | null; valor?: number | null; msg?: string | null } | null;
    crlv?: { pdf?: string | null; uf?: string | null; consultaId?: string | null } | null;
    score?: { score?: string | null; probabilidade?: string | null; mensagem?: string | null; nome?: string | null; situacao?: string | null; renda?: string | null } | null;
  };
  const vehicle = report.vehicle ?? {};
  const fields: Array<[string, unknown]> = [
    ["Marca", vehicle.marca],
    ["Modelo", vehicle.modelo ?? vehicle.marcaModelo],
    ["Ano fabricação", vehicle.anoFabricacao],
    ["Ano modelo", vehicle.anoModelo],
    ["Cor", vehicle.cor],
    ["Combustível", vehicle.combustivel],
    ["Chassi", vehicle.chassi],
    ["Motor", vehicle.motor],
    ["RENAVAM", vehicle.renavam],
    ["Município / UF", [vehicle.municipio, vehicle.uf].filter(Boolean).join(" / ")],
    ["Situação", vehicle.situacao],
    ["Potência", vehicle.potencia],
    ["Passageiros", vehicle.passageiros],
  ];

  return (
    <div className="client-result">
      <div className="client-result-header">
        <span className="client-result-plate">{lookupType === "placa" ? displayPlate(lookupValue, "auto") : lookupValue}</span>
        <span className="client-result-badge">Relatório liberado</span>
      </div>
      {report.fipe?.valor && (
        <div className="client-result-fipe">
          <span>Valor FIPE</span>
          <strong>{report.fipe.valor}</strong>
          <small>{[report.fipe.modelo, report.fipe.anoModelo, report.fipe.combustivel].filter(Boolean).join(" · ")}</small>
          {report.fipe.mesReferencia && <small>Ref. {report.fipe.mesReferencia}</small>}
        </div>
      )}
      <div className="client-result-grid">
        {fields.filter(([, value]) => value).map(([label, value]) => (
          <div className="client-result-item" key={label}><span>{label}</span><strong>{String(value)}</strong></div>
        ))}
      </div>
      {report.multas && report.multas.length > 0 && (
        <div className="client-result-fines">
          <h3>Multas ({report.multas.length})</h3>
          {report.multas.slice(0, 20).map((fine, index) => (
            <div className="client-fine-row" key={index}>
              <div><strong>{fine.descricao ?? "Infração"}</strong><span>{[fine.dataHora, fine.local].filter(Boolean).join(" · ")}</span></div>
              <strong>{fine.valorDevido ?? fine.valor ?? "—"}</strong>
            </div>
          ))}
        </div>
      )}
      {report.rouboFurto && <ResultFlag label="Roubo / Furto" section={report.rouboFurto} />}
      {report.leilao && <ResultFlag label="Leilão" section={report.leilao} />}
      {report.recall && <ResultFlag label="Recall" section={report.recall} />}
      {report.gravame && <ResultFlag label="Gravame" section={report.gravame} />}

      {report.csvCompleta && (() => {
        const csv = report.csvCompleta!;
        const restricoes = csv.restricoes ?? [];
        const renajud = csv.renajud?.ocorrencias ?? [];
        const renainf = csv.renainf?.ocorrencias ?? [];
        const proprietario = csv.bin?.proprietario ?? csv.proprietario;
        return (
          <div className="client-result-csv">
            <h3>CSV Completa</h3>
            {restricoes.length > 0 && (
              <div className="csv-restricoes">
                <strong>Alertas encontrados:</strong>
                {restricoes.map((item, index) => (
                  <div className="csv-restricao-item" key={index}>{item.mensagem}</div>
                ))}
              </div>
            )}
            {renajud.length > 0 && (
              <div className="csv-block">
                <strong>RENAJUD ({renajud.length})</strong>
                {renajud.slice(0, 10).map((item, index) => (
                  <div className="csv-row" key={index}>
                    <span>{item.processo ?? "Processo não informado"}</span>
                    <small>{[item.tribunal, item.orgao, item.data].filter(Boolean).join(" · ")}</small>
                  </div>
                ))}
              </div>
            )}
            {renainf.length > 0 && (
              <div className="csv-block">
                <strong>RENAINF ({renainf.length})</strong>
                {renainf.slice(0, 10).map((item, index) => (
                  <div className="csv-row" key={index}>
                    <span>{item.descricao ?? "Infração"}</span>
                    <small>{[item.local, item.data].filter(Boolean).join(" · ")}</small>
                  </div>
                ))}
              </div>
            )}
            {proprietario?.nome && (
              <div className="csv-owner">
                Proprietário: <strong>{proprietario.nome}</strong>
              </div>
            )}
          </div>
        );
      })()}

      {report.debitos && (report.debitos.pdf || report.debitos.valor) && (
        <div className="client-result-debitos">
          <h3>Débitos veiculares</h3>
          {report.debitos.valor ? <strong>Valor: {formatCentsToReal(report.debitos.valor * 100)}</strong> : null}
          {report.debitos.pdf && (
            <a className="client-pdf-link" href={report.debitos.pdf} target="_blank" rel="noopener noreferrer">
              Abrir boleto em PDF
            </a>
          )}
          {report.debitos.msg && <small>{report.debitos.msg}</small>}
        </div>
      )}

      {report.crlv?.pdf && (
        <div className="client-result-crlv">
          <h3>Documento CRLV</h3>
          <a className="client-pdf-link" href={report.crlv.pdf} target="_blank" rel="noopener noreferrer">
            Baixar CRLV em PDF {report.crlv.uf ? `(${report.crlv.uf})` : ""}
          </a>
        </div>
      )}

      {report.score && (report.score.score || report.score.nome) && (
        <div className="client-result-score">
          <h3>Score de crédito</h3>
          {report.score.nome && <div className="score-name">{report.score.nome}</div>}
          {report.score.score && <div className="score-value">{report.score.score}</div>}
          {report.score.probabilidade && <small>Probabilidade: {report.score.probabilidade}</small>}
          {report.score.situacao && <small>Situação: {report.score.situacao}</small>}
          {report.score.renda && <small>Renda presumida: {report.score.renda}</small>}
          {report.score.mensagem && <p className="score-msg">{report.score.mensagem}</p>}
        </div>
      )}
    </div>
  );
}

function ResultFlag({ label, section }: { label: string; section: { headline?: string | null; state?: string } }) {
  return (
    <div className={`client-flag state-${section.state ?? "unknown"}`}>
      <span>{label}</span>
      <strong>{section.headline ?? (section.state === "alert" ? "Verificar" : section.state === "clear" ? "Nada consta" : "Inconclusivo")}</strong>
    </div>
  );
}

function displayPlate(value: string, format: PlateFormatSelection): string {
  const plate = convertPlateFormat(normalizePlate(value), format);
  return getPlateFormat(plate) === "antiga" && plate.length === 7
    ? `${plate.slice(0, 3)}-${plate.slice(3)}`
    : plate;
}

function serviceSummary(services: ServiceSelection): string {
  const selected = serviceOptions.filter((option) => services[option.key]).map((option) => option.name);
  return selected.length ? selected.join(", ") : "Nenhum serviço extra";
}

function statusLabel(status: OrderRecord["status"]): string {
  switch (status) {
    case "pending": return "Aguardando pagamento";
    case "paid": return "Aguardando confirmação";
    case "confirmed": return "Liberado";
    case "cancelled": return "Cancelado";
    case "expired": return "Expirado";
  }
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const shared = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "car": return <svg {...shared}><path d="m5 11 1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><path d="M3.5 11.5A2.5 2.5 0 0 1 6 9h12a2.5 2.5 0 0 1 2.5 2.5V18H3.5z"/><path d="M3.5 14h17M7 18v1.5M17 18v1.5M7 13h.01M17 13h.01"/></svg>;
    case "search": return <svg {...shared}><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/></svg>;
    case "history": return <svg {...shared}><path d="M3.5 12a8.5 8.5 0 1 0 2.4-5.9L3.5 8.5"/><path d="M3.5 4.5v4h4M12 7.5V12l3 2"/></svg>;
    case "shield": return <svg {...shared}><path d="M12 3 19 6v5.2c0 4.3-2.9 7.7-7 9.8-4.1-2.1-7-5.5-7-9.8V6z"/><path d="m9 12 2 2 4-4"/></svg>;
    case "ticket": return <svg {...shared}><path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/><path d="M13 7v2M13 12v1M13 16v1"/></svg>;
    case "auction": return <svg {...shared}><path d="m14 5 5 5M12 7l5 5M4 20h16M6 17h12M8 14l6-6 3 3-6 6zM5 11l3-3 2 2-3 3z"/></svg>;
    case "wrench": return <svg {...shared}><path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4l-3 3-3-3z"/></svg>;
    case "chart": return <svg {...shared}><path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/><path d="M16 7h3v3"/></svg>;
    case "lock": return <svg {...shared}><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3M12 14v3"/></svg>;
    case "check": return <svg {...shared}><path d="m5 12 4 4L19 6"/></svg>;
    case "alert": return <svg {...shared}><path d="M12 3 2.8 19h18.4z"/><path d="M12 9v4M12 16h.01"/></svg>;
    case "pix": return <svg {...shared}><path d="M12 2 5 9l7 7 7-7z"/><path d="M8 9h8"/><path d="M12 2v14"/><circle cx="12" cy="20" r="1.5"/></svg>;
    case "plate": return <svg {...shared}><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h2M11 10h2M15 10h2M7 14h10"/></svg>;
    case "chevron": return <svg {...shared}><path d="m9 18 6-6-6-6"/></svg>;
    case "doc": return <svg {...shared}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>;
    case "boleto": return <svg {...shared}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg>;
    case "score": return <svg {...shared}><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/><circle cx="19" cy="7" r="2"/></svg>;
  }
}

type IconName = "car" | "search" | "history" | "shield" | "ticket" | "auction" | "wrench" | "chart" | "lock" | "check" | "alert" | "pix" | "plate" | "chevron" | "doc" | "boleto" | "score";
