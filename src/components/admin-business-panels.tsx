"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { formatCentsToReal } from "@/lib/pix";

interface BusinessSettings {
  key: string;
  markupPercent: string;
  fixedFeeCents: number;
  minimumChargeCents: number;
  freeLookupEnabled: boolean;
  pixProvider: string;
  pixKeyType: string;
  pixKey: string;
  merchantName: string;
  merchantCity: string;
}

interface OrderRow {
  id: number;
  visitorId: string;
  lookupType: "placa" | "renavam";
  lookupValue: string;
  services: Record<string, boolean>;
  costCents: number;
  priceCents: number;
  status: "pending" | "paid" | "confirmed" | "cancelled" | "expired";
  pixTxId: string | null;
  pixProvider: string;
  createdAt: string;
  paidAt: string | null;
  confirmedAt: string | null;
  result: unknown;
}

export function AdminPricingPanel() {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [markup, setMarkup] = useState("40");
  const [fixedFee, setFixedFee] = useState("0");
  const [minimum, setMinimum] = useState("1.99");
  const [freeLookup, setFreeLookup] = useState(true);
  const [merchantName, setMerchantName] = useState("ARCA CONSULTAS");
  const [pixProvider, setPixProvider] = useState("manual");
  const [pixKeyType, setPixKeyType] = useState("random");
  const [pixKey, setPixKey] = useState("");
  const [mpAccessToken, setMpAccessToken] = useState("");
  const [mpWebhookSecret, setMpWebhookSecret] = useState("");
  const [hasMpToken, setHasMpToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/business", { cache: "no-store" });
      const data = (await response.json()) as {
        settings?: BusinessSettings & { mpAccessToken?: string };
        hasMpToken?: boolean;
      };
      if (data.settings) {
        const s = data.settings;
        setSettings(s);
        setMarkup(s.markupPercent);
        setFixedFee((s.fixedFeeCents / 100).toString());
        setMinimum((s.minimumChargeCents / 100).toString());
        setFreeLookup(s.freeLookupEnabled);
        setMerchantName(s.merchantName);
        setPixProvider(s.pixProvider);
        setPixKeyType(s.pixKeyType);
        setPixKey(s.pixKey);
        setHasMpToken(Boolean(data.hasMpToken));
      }
    } catch {
      setError("Falha ao carregar configurações.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/settings/business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markupPercent: Number(markup),
          fixedFeeCents: Math.round(Number(fixedFee) * 100),
          minimumChargeCents: Math.round(Number(minimum) * 100),
          freeLookupEnabled: freeLookup,
          merchantName,
          pixProvider,
          pixKeyType,
          pixKey,
          mpAccessToken: mpAccessToken || undefined,
          mpWebhookSecret: mpWebhookSecret || undefined,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        hasMpToken?: boolean;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || "Falha ao salvar.");
      setHasMpToken(Boolean(data.hasMpToken));
      setMpAccessToken("");
      setMpWebhookSecret("");
      setMessage("Configurações de negócio salvas!");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/webhooks/mercadopago`
      : "/api/webhooks/mercadopago";

  return (
    <section className="settings-page-panel">
      <div className="settings-page-heading">
        <div>
          <div className="section-kicker">PRECIFICAÇÃO E PAGAMENTO</div>
          <h2>Configurações de Negócio</h2>
          <p>Defina a porcentagem sobre o custo da APIBrasil e como receber via PIX.</p>
        </div>
        <span className={`report-source ${settings ? "real-source" : "demo-source"}`}>
          <span />Configurado
        </span>
      </div>

      <form className="api-settings-form" onSubmit={(event) => void save(event)}>
        <div className="settings-secret-grid">
          <label className="settings-field">
            <span>MARKUP SOBRE O CUSTO (%)</span>
            <input type="number" min={0} max={900} step={1} value={markup} onChange={(event) => setMarkup(event.currentTarget.value)} required />
            <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
              Ex.: 40% sobre R$ 0,14 = R$ 0,20 cobrado do cliente.
            </small>
          </label>
          <label className="settings-field">
            <span>TAXA FIXA POR CONSULTA (R$)</span>
            <input type="number" min={0} step={0.01} value={fixedFee} onChange={(event) => setFixedFee(event.currentTarget.value)} />
          </label>
          <label className="settings-field">
            <span>VALOR MÍNIMO COBRADO (R$)</span>
            <input type="number" min={0} step={0.01} value={minimum} onChange={(event) => setMinimum(event.currentTarget.value)} />
          </label>
          <label className="settings-field">
            <span>NOME DO RECEBEDOR (PIX)</span>
            <input type="text" value={merchantName} onChange={(event) => setMerchantName(event.currentTarget.value)} maxLength={25} required />
          </label>
        </div>

        <div className="provider-selector">
          <span className="field-label">FORMA DE RECEBIMENTO PIX</span>
          <div className="provider-options">
            <label className={`provider-option ${pixProvider === "manual" ? "selected" : ""}`}>
              <input type="radio" name="pixProvider" value="manual" checked={pixProvider === "manual"} onChange={() => setPixProvider("manual")} />
              <strong>PIX Manual</strong>
              <small>Gera o BRCode com sua chave PIX. O cliente informa o pagamento e você confirma no painel.</small>
            </label>
            <label className={`provider-option ${pixProvider === "mercadopago" ? "selected" : ""}`}>
              <input type="radio" name="pixProvider" value="mercadopago" checked={pixProvider === "mercadopago"} onChange={() => setPixProvider("mercadopago")} />
              <strong>Mercado Pago (automático)</strong>
              <small>Cobra via API do Mercado Pago. A consulta é liberada automaticamente quando o PIX é aprovado.</small>
            </label>
          </div>
        </div>

        {pixProvider === "manual" ? (
          <div className="settings-secret-grid">
            <label className="settings-field">
              <span>TIPO DA CHAVE PIX</span>
              <select value={pixKeyType} onChange={(event) => setPixKeyType(event.currentTarget.value)}>
                <option value="cpf">CPF</option>
                <option value="cnpj">CNPJ</option>
                <option value="email">E-mail</option>
                <option value="phone">Telefone</option>
                <option value="random">Chave aleatória</option>
              </select>
            </label>
            <label className="settings-field">
              <span>CHAVE PIX</span>
              <input type="text" value={pixKey} onChange={(event) => setPixKey(event.currentTarget.value)} placeholder="Sua chave PIX de recebimento" required={pixProvider === "manual"} />
            </label>
          </div>
        ) : (
          <div className="settings-secret-grid">
            <label className="settings-field">
              <span>MERCADO PAGO — ACCESS TOKEN</span>
              <input
                type="password"
                value={mpAccessToken}
                onChange={(event) => setMpAccessToken(event.currentTarget.value)}
                placeholder={hasMpToken ? "•••••••• Token salvo (deixe vazio para manter)" : "APP_USR-..."}
                autoComplete="new-password"
              />
              <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                Obtido em Mercado Pago → Seu negócio → Credenciais. Use token de produção.
              </small>
            </label>
            <label className="settings-field">
              <span>SEGREDO DO WEBHOOK (opcional)</span>
              <input
                type="password"
                value={mpWebhookSecret}
                onChange={(event) => setMpWebhookSecret(event.currentTarget.value)}
                placeholder="Assinatura secreta do webhook"
                autoComplete="new-password"
              />
              <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                Usado para validar as notificações recebidas.
              </small>
            </label>
          </div>
        )}

        {pixProvider === "mercadopago" && (
          <div className="webhook-info">
            <strong>URL do Webhook (configure no painel do Mercado Pago):</strong>
            <div className="webhook-url-box">
              <code>{webhookUrl}</code>
            </div>
            <small>
              Acesse Mercado Pago → Seu negócio → Webhooks e cole essa URL. Sem ela, a confirmação
              acontece por consulta automática de status a cada poucos segundos.
            </small>
          </div>
        )}

        <label className="settings-field">
          <span>CONSULTA BÁSICA GRATUITA (opcional)</span>
          <label className="authorization-check">
            <input type="checkbox" checked={freeLookup} onChange={(event) => setFreeLookup(event.currentTarget.checked)} />
            <span className="custom-check"><Icon name="check" size={12} /></span>
            <span>Liberar marca/modelo/ano antes do pagamento (consulta agregados-simples, R$ 0,02).</span>
          </label>
        </label>

        {message && <div className="settings-success">{message}</div>}
        {error && <div className="inline-alert error-alert">{error}</div>}
        <div className="settings-actions">
          <button className="modal-done-button" type="submit" disabled={busy}>
            {busy ? "Salvando…" : "Salvar negócio"}
          </button>
        </div>
      </form>

      <div className="pricing-preview">
        <h3>Simulação de preço</h3>
        <div className="pricing-preview-grid">
          <div><span>Custo APIBrasil (básico)</span><strong>{formatCentsToReal(2)}</strong></div>
          <div><span>+ Markup {markup}%</span><strong>{formatCentsToReal(Math.round(2 * Number(markup || 0)) / 1)}</strong></div>
          <div><span>+ Taxa fixa</span><strong>{formatCentsToReal(Math.round(Number(fixedFee || 0) * 100))}</strong></div>
          <div className="total"><span>Cliente paga</span><strong>{formatCentsToReal(Math.max(Math.round(2 * Number(markup || 0)) + Math.round(Number(fixedFee || 0) * 100), Math.round(Number(minimum || 0) * 100)))}</strong></div>
        </div>
        <p className="pricing-note">A simulação usa apenas o custo básico (R$ 0,02). O preço final considera os serviços que o cliente marcar.</p>
      </div>
    </section>
  );
}

export function AdminOrdersPanel() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/orders/confirm", { cache: "no-store" });
      const data = (await response.json()) as { items?: OrderRow[] };
      if (data.items) setOrders(data.items);
    } catch {
      setError("Falha ao carregar pedidos.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirm(id: number) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/orders/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: id, action: "confirm" }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Falha ao confirmar.");
      setMessage(`Pedido #${id} confirmado e consulta liberada.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao confirmar.");
    } finally {
      setBusy(false);
    }
  }

  async function reject(id: number) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/orders/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: id, action: "reject" }),
      });
      if (!response.ok) throw new Error("Falha ao cancelar.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao cancelar.");
    } finally {
      setBusy(false);
    }
  }

  const pending = orders.filter((order) => order.status === "pending");
  const paid = orders.filter((order) => order.status === "paid");

  return (
    <section className="settings-page-panel">
      <div className="settings-page-heading">
        <div>
          <div className="section-kicker">PEDIDOS DE CONSULTA</div>
          <h2>Pagamentos Recebidos</h2>
          <p>Pedidos pagos via Mercado Pago são liberados automaticamente. Use esta tela apenas para PIX manual.</p>
        </div>
        <span className="report-source demo-source">
          <span />
          {pending.length} aguardando · {paid.length} pagos
        </span>
      </div>

      {message && <div className="settings-success">{message}</div>}
      {error && <div className="inline-alert error-alert">{error}</div>}

      {orders.length === 0 ? (
        <div className="empty-history">
          <div className="empty-icon"><Icon name="ticket" size={24} /></div>
          <div>
            <strong>Nenhum pedido ainda</strong>
            <p>Quando clientes gerarem PIX, os pedidos aparecem aqui.</p>
          </div>
        </div>
      ) : (
        <div className="orders-list">
          {orders.map((order) => (
            <div className="order-row" key={order.id}>
              <div className="order-main">
                <div className="order-plate">
                  <Icon name={order.lookupType === "placa" ? "car" : "search"} size={16} />
                  <strong>{order.lookupValue}</strong>
                  <span className={`history-status status-${order.status}`}>{orderStatus(order.status)}</span>
                  {order.pixProvider === "mercadopago" && <span className="provider-tag">MP</span>}
                </div>
                <div className="order-meta">
                  {new Date(order.createdAt).toLocaleString("pt-BR")} · {orderSummary(order.services)} · Custo{" "}
                  {formatCentsToReal(order.costCents)} → Cobrado {formatCentsToReal(order.priceCents)}
                </div>
                {order.pixTxId && <div className="order-txid">TXID: {order.pixTxId}</div>}
              </div>
              <div className="order-actions">
                {(order.status === "pending" || order.status === "paid") && (
                  <>
                    <button className="modal-done-button" type="button" disabled={busy} onClick={() => void confirm(order.id)}>
                      Confirmar e liberar
                    </button>
                    <button className="text-button" type="button" disabled={busy} onClick={() => void reject(order.id)}>
                      Cancelar
                    </button>
                  </>
                )}
                {order.status === "confirmed" && (
                  <span className="order-confirmed">
                    Liberado em {order.confirmedAt ? new Date(order.confirmedAt).toLocaleString("pt-BR") : "—"}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function orderStatus(status: OrderRow["status"]): string {
  switch (status) {
    case "pending": return "Aguardando";
    case "paid": return "Pago";
    case "confirmed": return "Liberado";
    case "cancelled": return "Cancelado";
    case "expired": return "Expirado";
  }
}

function orderSummary(services: Record<string, boolean>): string {
  const names: Record<string, string> = {
    fipe: "FIPE",
    multas: "Multas",
    roubo: "Roubo",
    leilao: "Leilão",
    recall: "Recall",
  };
  const selected = Object.entries(services)
    .filter(([, value]) => value)
    .map(([key]) => names[key] ?? key);
  return selected.length ? selected.join(", ") : "Básico";
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
    case "car":
      return (
        <svg {...shared}>
          <path d="m5 11 1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11" />
          <path d="M3.5 11.5A2.5 2.5 0 0 1 6 9h12a2.5 2.5 0 0 1 2.5 2.5V18H3.5z" />
          <path d="M3.5 14h17M7 18v1.5M17 18v1.5M7 13h.01M17 13h.01" />
        </svg>
      );
    case "search":
      return (
        <svg {...shared}>
          <circle cx="10.8" cy="10.8" r="6.8" />
          <path d="m16 16 4 4" />
        </svg>
      );
    case "ticket":
      return (
        <svg {...shared}>
          <path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z" />
          <path d="M13 7v2M13 12v1M13 16v1" />
        </svg>
      );
    case "check":
      return (
        <svg {...shared}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );
  }
}

type IconName = "car" | "search" | "ticket" | "check";
