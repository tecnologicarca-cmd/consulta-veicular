"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import FreeFipeSearch from "@/components/free-fipe-search";
import LicensePlateStamp from "@/components/license-plate-stamp";
import ProvidersGuide from "@/components/providers-guide";
import { AdminPricingPanel, AdminOrdersPanel } from "@/components/admin-business-panels";
import ClientSharePanel from "@/components/client-share-panel";
import {
  convertPlateFormat,
  defaultServiceSelection,
  getPlateFormat,
  isValidPlate,
  isValidRenavam,
  normalizePlate,
  normalizeRenavam,
  optionalServices,
  type ConsultationHistoryEntry,
  type ConsultationReport,
  type LookupType,
  type OptionalService,
  type PlateFormatSelection,
  type ProviderSection,
  type ServiceSelection,
} from "@/lib/vehicles";

type ActiveTab = "consulta" | "historico" | "configuracoes" | "precificacao" | "pedidos" | "cliente" | "provedores";
type ThemeMode = "dark" | "light";

type ProviderStatus = {
  publicPlateConfigured: boolean;
  publicFipeAvailable: boolean;
  paidConfigured: boolean;
  message: string;
};
type DashboardStats = { total: number; thisMonth: number };
type EndpointSettings = { dados: string; renavam: string; fipe: string; multas: string; roubo: string; leilao: string; recall: string };
type SettingsData = {
  configured: boolean;
  adminConfigured: boolean;
  hasBearer: boolean;
  hasDevice: boolean;
  baseUrl: string;
  endpoints: EndpointSettings;
  updatedAt: string | null;
  source: string;
  accountBalance?: string | null;
  accountMessage?: string | null;
  accountError?: string | null;
};
type ServiceOption = {
  key: OptionalService;
  name: string;
  description: string;
  price: number;
  icon: IconName;
};

const serviceOptions: ServiceOption[] = [
  { key: "multas", name: "Multas Estaduais", description: "Débitos e infrações via RENAINF.", price: 3.45, icon: "ticket" },
  { key: "roubo", name: "Roubo e Furto", description: "Alerta de restrição policial / ocorrências.", price: 3.86, icon: "shield" },
  { key: "leilao", name: "Histórico de Leilão", description: "Verificação em bases integradas de leilão.", price: 21.12, icon: "auction" },
  { key: "recall", name: "Recall de Montadora", description: "Campanhas de recall pendentes.", price: 0.62, icon: "wrench" },
  { key: "fipe", name: "FIPE APIBrasil (Opcional)", description: "Endpoint FIPE pago da APIBrasil (desnecessário pois resolvemos de graça abaixo).", price: 0.06, icon: "chart" },
  { key: "gravame", name: "Gravame", description: "Alienação fiduciária e histórico de financiamento.", price: 2.71, icon: "lock" },
  { key: "csv", name: "CSV Completa", description: "RENAINF + RENAJUD + BIN nacional + recall em uma chamada.", price: 4.0, icon: "doc" },
  { key: "debitos", name: "Débitos (boleto)", description: "Débitos veiculares com boleto para pagamento.", price: 12.0, icon: "boleto" },
  { key: "crlv", name: "Documento CRLV", description: "Emissão do documento CRLV em PDF.", price: 14.0, icon: "doc" },
  { key: "score", name: "Score CPF", description: "Score de crédito Acerta Essencial por CPF.", price: 0.34, icon: "score" },
];

const defaultEndpoints: EndpointSettings = {
  dados: "/vehicles/dados",
  renavam: "/vehicles/base/000/dados",
  fipe: "/vehicles/fipe",
  multas: "/vehicles/multas",
  roubo: "/vehicles/roubo-furto",
  leilao: "/vehicles/leilao",
  recall: "/vehicles/recall",
};

const providerSteps = [
  "Validando parâmetros e placa/RENAVAM…",
  "Consultando a base APIBrasil…",
  "Resolvendo Tabela FIPE gratuita automaticamente…",
  "Consolidando relatório completo…",
];

export default function ConsultationDashboard() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("consulta");
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [lookupType, setLookupType] = useState<LookupType>("placa");
  const [lookupText, setLookupText] = useState("");
  const [platePreference, setPlatePreference] = useState<PlateFormatSelection>("auto");
  const [services, setServices] = useState<ServiceSelection>(defaultServiceSelection);
  const [busy, setBusy] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [reports, setReports] = useState<ConsultationReport[]>([]);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<ConsultationHistoryEntry[]>([]);
  const [stats, setStats] = useState<DashboardStats>({ total: 0, thisMonth: 0 });
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [clearingHistory, setClearingHistory] = useState(false);

  // Initialize and persist theme
  useEffect(() => {
    const saved = localStorage.getItem("arca_theme") as ThemeMode | null;
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }, []);

  function toggleTheme() {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("arca_theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  // Parse multi identifiers (up to 10)
  const lookupValues = useMemo(
    () =>
      lookupText
        .split(/[\s,;]+/)
        .map((value) => (lookupType === "renavam" ? normalizeRenavam(value) : normalizePlate(value)))
        .filter(Boolean),
    [lookupText, lookupType],
  );

  const lookupIsValid =
    lookupValues.length > 0 &&
    lookupValues.length <= 10 &&
    lookupValues.every((value) => (lookupType === "renavam" ? isValidRenavam(value) : isValidPlate(value)));

  const selectedCount = optionalServices.filter((service) => services[service]).length;
  const estimatedPerVehicle =
    (providerStatus?.paidConfigured ? 0.14 : 0) +
    serviceOptions.reduce((sum, option) => sum + (services[option.key] ? option.price : 0), 0);
  const estimatedTotal = estimatedPerVehicle * (lookupValues.length || 1);

  const refreshDashboard = useCallback(async () => {
    const [statusResult, historyResult] = await Promise.allSettled([
      fetch("/api/vehicles/status", { cache: "no-store" }),
      fetch("/api/vehicles/history", { cache: "no-store" }),
    ]);
    if (statusResult.status === "fulfilled" && statusResult.value.ok) {
      setProviderStatus((await statusResult.value.json()) as ProviderStatus);
    }
    if (historyResult.status === "fulfilled" && historyResult.value.ok) {
      const result = (await historyResult.value.json()) as { items?: ConsultationHistoryEntry[]; stats?: DashboardStats };
      setHistory(Array.isArray(result.items) ? result.items : []);
      setStats(result.stats ?? { total: 0, thisMonth: 0 });
    }
  }, []);

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  function updateLookupText(value: string) {
    const separators = /([\s,;]+)/;
    const next =
      lookupType === "renavam"
        ? value
            .split(separators)
            .map((part) => (/^[\s,;]+$/.test(part) ? part : normalizeRenavam(part)))
            .join("")
        : value
            .split(separators)
            .map((part) => (/^[\s,;]+$/.test(part) ? part : displayPlate(part, platePreference)))
            .join("");
    setLookupText(next);
    setReports([]);
    setError("");
  }

  function changeLookupType(next: LookupType) {
    setLookupType(next);
    setLookupText("");
    setReports([]);
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
    setReports([]);
    setError("");
  }

  function toggleService(key: OptionalService) {
    setServices((current) => ({ ...current, [key]: !current[key] }));
  }

  async function submitConsultation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lookupIsValid || busy) return;
    setBusy(true);
    setError("");
    setReports([]);
    setActiveTab("consulta");
    setProgressStep(0);
    const timer = window.setInterval(
      () => setProgressStep((step) => Math.min(step + 1, providerSteps.length - 1)),
      1_400,
    );
    try {
      const response = await fetch("/api/vehicles/consult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookupType, identificadores: lookupValues, servicos: services }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        data?: { reports?: ConsultationReport[] };
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.data?.reports) {
        throw new Error(payload.error || "Não foi possível concluir a consulta.");
      }
      setReports(payload.data.reports);
      await refreshDashboard();
      window.setTimeout(
        () => document.getElementById("resultados")?.scrollIntoView({ behavior: "smooth", block: "start" }),
        80,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha de comunicação. Tente novamente.");
    } finally {
      window.clearInterval(timer);
      setBusy(false);
    }
  }

  async function deleteHistory() {
    if (!history.length || clearingHistory) return;
    if (!window.confirm("Excluir o histórico de consultas deste navegador?")) return;
    setClearingHistory(true);
    try {
      const response = await fetch("/api/vehicles/history", { method: "DELETE" });
      if (!response.ok) throw new Error("Não foi possível excluir o histórico.");
      setHistory([]);
      setStats({ total: 0, thisMonth: 0 });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível excluir o histórico.");
    } finally {
      setClearingHistory(false);
    }
  }

  function reuseSearch(entry: ConsultationHistoryEntry) {
    setLookupType(entry.searchType);
    setLookupText(
      entry.searchType === "placa"
        ? displayPlate(entry.searchValue, platePreference)
        : normalizeRenavam(entry.searchValue),
    );
    setReports([]);
    setError("");
    setActiveTab("consulta");
    window.setTimeout(
      () => document.getElementById("consulta")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      80,
    );
  }

  const firstValue = lookupValues[0] || "";

  return (
    <div className="app-shell">
      {/* SIDEBAR NAVIGATION */}
      <aside className="sidebar">
        <a className="brand-lockup" href="#inicio" aria-label="Arca Consultas">
          <span className="brand-mark">
            <Icon name="car" size={24} />
          </span>
          <span className="brand-wordmark">
            arca<span>.</span>
            <small>CONSULTAS VEICULARES</small>
          </span>
        </a>

        <div className="sidebar-caption">ESPAÇO DE TRABALHO</div>
        <nav className="side-nav" aria-label="Navegação principal">
          <TabButton active={activeTab === "consulta"} icon="search" onClick={() => setActiveTab("consulta")}>
            Consulta Veicular
          </TabButton>
          <TabButton active={activeTab === "historico"} icon="history" onClick={() => setActiveTab("historico")}>
            Histórico ({stats.total})
          </TabButton>
          <TabButton active={activeTab === "configuracoes"} icon="settings" onClick={() => setActiveTab("configuracoes")}>
            Configurações APIBrasil
          </TabButton>
          <TabButton active={activeTab === "precificacao"} icon="chart" onClick={() => setActiveTab("precificacao")}>
            Precificação e PIX
          </TabButton>
          <TabButton active={activeTab === "pedidos"} icon="ticket" onClick={() => setActiveTab("pedidos")}>
            Pedidos
          </TabButton>
          <TabButton active={activeTab === "cliente"} icon="search" onClick={() => setActiveTab("cliente")}>
            App do Cliente
          </TabButton>
<TabButton active={activeTab === "provedores"} icon="shield" onClick={() => setActiveTab("provedores")}>
            Guia de Provedores
          </TabButton>
        </nav>

        <div className="side-divider" />

        <div className="sidebar-caption">INTEGRAÇÃO APIBRASIL</div>
        <button className="connection-card" type="button" onClick={() => setActiveTab("configuracoes")}>
          <span className={`connection-dot ${providerStatus?.paidConfigured ? "is-live" : "is-demo"}`} />
          <span className="connection-copy">
            <strong>{providerStatus?.paidConfigured ? "APIBrasil Conectada" : "Configurar Tokens"}</strong>
            <small>{providerStatus?.paidConfigured ? "Placa + RENAVAM ativos" : "Bearer + Device Token"}</small>
          </span>
          <Icon name="chevron" size={15} />
        </button>

        <div className="sidebar-spacer" />

        <div className="sidebar-help">
          <div className="help-icon">
            <Icon name="spark" size={18} />
          </div>
          <strong>Tabela FIPE Integrada:</strong>
          <p>Consulta FIPE oficial combinada automaticamente com os dados do veículo para economizar seus créditos!</p>
        </div>

        <div className="sidebar-user">
          <div className="user-avatar">AC</div>
          <div>
            <strong>Arca Veicular</strong>
            <small>Opção 3 · Híbrida Inteligente</small>
          </div>
          <Icon name="dots" size={18} />
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="main-column" id="inicio">
        {/* TOPBAR */}
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <Icon name="chevron" size={13} />
            <strong>{tabTitle(activeTab)}</strong>
          </div>

          <div className="topbar-actions">
            {/* THEME TOGGLE: DARK VS LIGHT */}
            <button
              className="theme-toggle-btn"
              type="button"
              onClick={toggleTheme}
              aria-label="Alternar tema de cor"
              title="Alternar entre tema Azul Noturno (escuro) e Azul Executivo (claro)"
            >
              <span>{theme === "dark" ? "🌙" : "☀️"}</span>
              <span>{theme === "dark" ? "Azul Noturno" : "Azul Executivo"}</span>
            </button>

            <div className={`top-status ${providerStatus?.paidConfigured ? "connected" : "demo"}`}>
              <span />
              {providerStatus?.paidConfigured ? "APIBrasil Pronta" : "Aguardando Tokens"}
            </div>

            <button
              className="icon-button settings-button"
              type="button"
              onClick={() => setActiveTab("configuracoes")}
            >
              <Icon name="settings" size={16} />
              <span>Configurar API</span>
            </button>
          </div>
        </header>

        <div className="page-content">
          {/* HERO GREETING */}
          <section className="welcome-row">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-line" />
                PLATAFORMA VEICULAR INTEGRADA · OPÇÃO 3 DEFINITIVA
              </div>
              <h1>
                Pesquisa Completa por <span>Placa e RENAVAM</span>
              </h1>
              <p>
                Visual estampado no padrão oficial brasileiro, resolução automática da Tabela FIPE sem custo e serviços
                complementares sob demanda da APIBrasil.
              </p>
            </div>

            <div className="welcome-stamp">
              <div>
                <Icon name="spark" size={20} />
              </div>
              <span>
                FIPE GRÁTIS
                <br />
                INTELIGENTE
              </span>
            </div>
          </section>

          {/* TAB 1: CONSULTA */}
          {activeTab === "consulta" && (
            <>
              {/* METRICS */}
              <section className="metrics-grid" aria-label="Resumo do histórico">
                <MetricCard icon="history" label="Consultas Realizadas" value={String(stats.total)} detail="Neste navegador" />
                <MetricCard icon="calendar" label="Neste Mês" value={String(stats.thisMonth)} detail="Registros no PostgreSQL" />
                <div className="metric-card metric-source">
                  <div className="metric-icon">
                    <Icon name="pulse" size={20} />
                  </div>
                  <div className="metric-copy">
                    <span>Motor de Consulta</span>
                    <strong>{providerStatus?.paidConfigured ? "APIBrasil + FIPE Grátis" : "FIPE Grátis (Tokens pendentes)"}</strong>
                    <small>
                      {providerStatus?.paidConfigured
                        ? "Básico R$ 0,14 · FIPE R$ 0,00 · Extras sob demanda"
                        : "Configure APIBrasil para buscar dados cadastrais"}
                    </small>
                  </div>
                  <span className={`metric-status ${providerStatus?.paidConfigured ? "live" : "preview"}`} />
                </div>
              </section>

              {/* SEARCH PANEL WITH REALISTIC STAMPED PLATE */}
              <section className="consultation-panel" id="consulta">
                <div className="panel-heading">
                  <div>
                    <div className="section-kicker">
                      01 <span>PAINEL DE BUSCA VEICULAR</span>
                    </div>
                    <h2>Digite a Placa ou o RENAVAM</h2>
                    <p>
                      Veja o padrão visual brasileiro em tempo real enquanto digita. Aceita até 10 veículos de uma vez!
                    </p>
                  </div>

                  <button
                    className="secure-tag config-shortcut"
                    type="button"
                    onClick={() => setActiveTab("configuracoes")}
                  >
                    <Icon name="lock" size={14} />
                    {providerStatus?.paidConfigured ? "Tokens Salvos" : "Inserir Tokens APIBrasil"}
                  </button>
                </div>

                <form onSubmit={(event) => void submitConsultation(event)}>
                  {/* SELECTOR TABS: PLACA OU RENAVAM */}
                  <div className="lookup-type-tabs" role="group" aria-label="Selecione o tipo de identificador">
                    <button
                      type="button"
                      className={lookupType === "placa" ? "active" : ""}
                      aria-pressed={lookupType === "placa"}
                      onClick={() => changeLookupType("placa")}
                    >
                      <Icon name="plate" size={16} />
                      Consulta por Placa
                    </button>
                    <button
                      type="button"
                      className={lookupType === "renavam" ? "active" : ""}
                      aria-pressed={lookupType === "renavam"}
                      onClick={() => changeLookupType("renavam")}
                    >
                      <Icon name="search" size={16} />
                      Consulta por RENAVAM
                    </button>
                  </div>

                  {/* DIRECT VISUAL STAMPED INPUT: TYPE DIRECTLY ON THE PLATE OR RENAVAM CARD! */}
                  <div className="direct-stamp-wrapper">
                    <LicensePlateStamp
                      value={firstValue}
                      lookupType={lookupType}
                      preference={platePreference}
                      onChangePreference={changePlateFormat}
                      onDirectChange={(val) => {
                        updateLookupText(val);
                      }}
                      onSubmitDirect={() => {
                        const fakeEvent = { preventDefault: () => {} } as FormEvent<HTMLFormElement>;
                        void submitConsultation(fakeEvent);
                      }}
                      disabled={busy}
                    />

                    {/* ACTION BAR DIRECTLY BELOW STAMP */}
                    <div className="stamp-action-bar">
                      <div className="stamp-action-info">
                        <span className="stamp-type-badge">
                          {lookupType === "placa"
                            ? `Padrão: ${platePreference === "auto" ? "Automático" : platePreference === "mercosul" ? "Mercosul" : "Antiga"}`
                            : "Documento RENAVAM (9 ou 11 dígitos)"}
                        </span>
                        <small>
                          {lookupType === "placa"
                            ? "Digite as 7 letras/números diretamente na placa estampada acima!"
                            : "Digite os 9 ou 11 números diretamente no documento RENAVAM acima!"}
                        </small>
                      </div>

                      <button
                        className="submit-button stamp-submit-btn"
                        type="submit"
                        disabled={!lookupIsValid || busy}
                      >
                        {busy ? <span className="button-spinner" /> : <Icon name="search" size={18} />}
                        {busy ? "Consultando…" : lookupType === "placa" ? "Consultar Placa" : "Consultar RENAVAM"}
                        {!busy && <Icon name="arrow" size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* OPTIONAL MULTI-INSERTION DRAWER */}
                  <details className="multi-lookup-accordion">
                    <summary className="multi-lookup-summary">
                      <Icon name="dots" size={16} />
                      <span>Colar vários identificadores em lote (até 10 por vez)</span>
                      <span className="summary-count">{lookupValues.length} informado(s)</span>
                    </summary>

                    <div className="multi-lookup-drawer">
                      <label className="field-label" htmlFor="lookup-values">
                        {lookupType === "placa"
                          ? "Lista de placas (uma por linha ou separadas por vírgula):"
                          : "Lista de códigos RENAVAM (um por linha ou separados por vírgula):"}
                      </label>
                      <textarea
                        id="lookup-values"
                        className={`lookup-textarea ${lookupType === "placa" ? "is-plate" : "is-renavam"}`}
                        value={lookupText}
                        onChange={(event) => updateLookupText(event.currentTarget.value)}
                        placeholder={
                          lookupType === "placa"
                            ? "ABC-1234\nBRA2E19\nQWE3R45"
                            : "01234567890\n98765432100"
                        }
                        rows={3}
                        maxLength={400}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                  </details>

                  {/* SERVICES SELECTION */}
                  <div className="services-heading">
                    <div>
                      <span className="field-label">SERVIÇOS COMPLEMENTARES APIBRASIL</span>
                      <span className="included-hint">Marque apenas o que deseja consultar para economizar créditos</span>
                    </div>
                    <span className="service-count">
                      {selectedCount} {selectedCount === 1 ? "extra selecionado" : "extras selecionados"}
                    </span>
                  </div>

                  {/* BASE INCLUDED CARDS */}
                  <div className="included-grid">
                    <div className="included-card">
                      <span className="included-icon">
                        <Icon name="car" size={20} />
                      </span>
                      <div>
                        <strong>Dados Básicos do Veículo</strong>
                        <small>Marca, modelo, ano, chassi, motor, cor, município e situação</small>
                      </div>
                      <span className="included-price">
                        {providerStatus?.paidConfigured ? "R$ 0,14" : "Requer API"}
                        <small>por veículo*</small>
                      </span>
                    </div>

                    <div className="included-card">
                      <span className="included-icon fipe">
                        <Icon name="chart" size={20} />
                      </span>
                      <div>
                        <strong>Tabela FIPE Oficial</strong>
                        <small>Resolução inteligente automática com marca, modelo e ano</small>
                      </div>
                      <span className="included-price free-price">
                        Grátis (R$ 0,00)
                        <small>economizado!</small>
                      </span>
                    </div>
                  </div>

                  {/* OPTIONAL PAID SERVICES */}
                  <div className="optional-grid">
                    {serviceOptions.map((option) => (
                      <label
                        key={option.key}
                        className={`optional-card ${services[option.key] ? "selected" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={services[option.key]}
                          onChange={() => toggleService(option.key)}
                          aria-label={`Incluir serviço: ${option.name}`}
                        />
                        <span className="service-check">
                          <Icon name="check" size={12} />
                        </span>
                        <span className="optional-icon">
                          <Icon name={option.icon} size={18} />
                        </span>
                        <span className="optional-copy">
                          <strong>{option.name}</strong>
                          <small>{option.description}</small>
                          <b>+ {formatMoney(option.price)} estimado</b>
                        </span>
                      </label>
                    ))}
                  </div>

                  {/* FOOTER & ESTIMATE */}
                  <div className="consultation-footer">
                    <div className="free-tier-note">
                      <span className="included-icon">
                        <Icon name="spark" size={18} />
                      </span>
                      <div>
                        <strong>Modo de Custo Controlado</strong>
                        <small>
                          Seus tokens ficam guardados com segurança AES-GCM no PostgreSQL. Apenas os serviços marcados
                          acima serão disparados contra a APIBrasil.
                        </small>
                      </div>
                    </div>

                    <div className="estimate-box">
                      <span>{lookupValues.length || 1} veículo(s)</span>
                      <strong>
                        {providerStatus?.paidConfigured
                          ? formatMoney(estimatedTotal)
                          : "Configure APIBrasil"}
                      </strong>
                      <small>
                        {providerStatus?.paidConfigured
                          ? `R$ ${estimatedPerVehicle.toFixed(2)} por veículo (FIPE grátis inclusa)`
                          : "Vá para a aba Configurações"}
                      </small>
                    </div>
                  </div>

                  {/* PROGRESS BAR */}
                  {busy && (
                    <div className="loading-line" role="status">
                      <span className="loading-pulse" />
                      <span>{providerSteps[progressStep]}</span>
                      <div className="loading-track">
                        <i style={{ width: `${25 + progressStep * 25}%` }} />
                      </div>
                    </div>
                  )}

                  {/* ERROR MESSAGE */}
                  {error && (
                    <div className="inline-alert error-alert" role="alert">
                      <Icon name="alert" size={18} />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="cost-disclaimer">
                    <Icon name="info" size={15} />
                    <span>
                      *Valores estimados com base na tabela da APIBrasil. O débito real dependerá do plano contratado
                      na sua conta. A Tabela FIPE é obtida gratuitamente sem consumir créditos da APIBrasil.
                    </span>
                  </div>
                </form>
              </section>

              {/* REPORT RESULTS SECTION */}
              {reports.map((item, index) => (
                <ReportView key={`${item.lookupType}-${item.lookupValue}-${index}`} report={item} />
              ))}

              {/* DIRECT FREE FIPE SEARCH TOOL */}
              <FreeFipeSearch />
            </>
          )}

          {/* TAB 2: HISTÓRICO */}
          {activeTab === "historico" && (
            <section className="history-panel history-page">
              <div className="section-title-row">
                <div>
                  <div className="section-kicker">HISTÓRICO LOCAL PROTEGIDO</div>
                  <h2>Pesquisas Anteriores</h2>
                  <p>Consultas por placa e RENAVAM realizadas neste navegador.</p>
                </div>
                {history.length > 0 && (
                  <button
                    type="button"
                    className="text-button delete-history"
                    onClick={() => void deleteHistory()}
                    disabled={clearingHistory}
                  >
                    <Icon name="trash" size={15} />
                    {clearingHistory ? "Excluindo…" : "Limpar histórico"}
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <div className="empty-history">
                  <div className="empty-icon">
                    <Icon name="history" size={24} />
                  </div>
                  <div>
                    <strong>Nenhuma pesquisa recente</strong>
                    <p>Faça uma consulta para registrar no histórico isolado deste navegador.</p>
                  </div>
                </div>
              ) : (
                <div className="history-list">
                  {history.map((entry) => (
                    <div className="history-row" key={entry.id}>
                      <div className="history-plate-icon">
                        <Icon name={entry.searchType === "placa" ? "car" : "search"} size={18} />
                      </div>
                      <div className="history-main">
                        <strong>
                          {entry.searchType === "placa"
                            ? displayPlate(entry.searchValue, "auto")
                            : `RENAVAM ${entry.searchValue}`}
                        </strong>
                        <span>
                          {formatDate(entry.createdAt)} · {serviceSummary(entry.services)}
                        </span>
                      </div>
                      <span className={`history-status status-${entry.status}`}>{historyStatus(entry.status)}</span>
                      <span className="history-source">{historySource(entry.source)}</span>
                      <button
                        className="reuse-button"
                        type="button"
                        onClick={() => reuseSearch(entry)}
                        aria-label={`Repetir ${entry.searchType}: ${entry.searchValue}`}
                      >
                        <Icon name="arrow" size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* TAB 3: CONFIGURAÇÕES DA API */}
          {activeTab === "configuracoes" && (
            <ApiSettingsPanel onSaved={() => { void refreshDashboard(); }} />
          )}

          {/* TAB: PRECIFICAÇÃO E PIX */}
          {activeTab === "precificacao" && (
            <AdminPricingPanel />
          )}

          {/* TAB: PEDIDOS */}
          {activeTab === "pedidos" && <AdminOrdersPanel />}

          {/* TAB: APP DO CLIENTE */}
          {activeTab === "cliente" && <ClientSharePanel />}

          {/* TAB 4: GUIA DE PROVEDORES & FONTES ALTERNATIVAS */}
          {activeTab === "provedores" && <ProvidersGuide />}

          {/* FOOTER */}
          <footer className="page-footer">
            <span>ARCA CONSULTAS VEICULARES · OPÇÃO 3</span>
            <span>Tabela FIPE Oficial Gratuita · Integração APIBrasil · Proteção de Segredos AES-GCM</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function TabButton({
  active,
  icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: IconName;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`nav-link ${active ? "active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <Icon name={icon} size={18} />
      <span>{children}</span>
    </button>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: IconName;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="metric-card">
      <div className="metric-icon">
        <Icon name={icon} size={20} />
      </div>
      <div className="metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function ApiSettingsPanel({ onSaved }: { onSaved: () => void }) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [baseUrl, setBaseUrl] = useState("https://gateway.apibrasil.io/api/v2");
  const [endpoints, setEndpoints] = useState<EndpointSettings>(defaultEndpoints);
  const [bearerToken, setBearerToken] = useState("");
  const [deviceToken, setDeviceToken] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;
    void fetch("/api/vehicles/settings", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as SettingsData & { error?: string };
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar as configurações.");
        if (!alive) return;
        setSettings(data);
        setBaseUrl(data.baseUrl);
        setEndpoints(data.endpoints);
      })
      .catch((caught) => {
        if (alive) setError(caught instanceof Error ? caught.message : "Falha ao ler configuração segura.");
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/vehicles/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword, bearerToken, deviceToken, baseUrl, endpoints }),
      });
      const result = (await response.json()) as { ok?: boolean; settings?: SettingsData; error?: string };
      if (!response.ok || !result.ok || !result.settings) throw new Error(result.error || "Não foi possível salvar.");
      setSettings(result.settings);
      setBearerToken("");
      setDeviceToken("");
      setAdminPassword("");
      setNotice("Configuração salva com sucesso! Seus tokens foram cifrados no PostgreSQL com AES-GCM.");
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function clearCredentials() {
    if (!window.confirm("Deseja remover as credenciais salvas da APIBrasil?")) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/vehicles/settings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword }),
      });
      const result = (await response.json()) as { ok?: boolean; settings?: SettingsData; error?: string };
      if (!response.ok || !result.ok || !result.settings) throw new Error(result.error || "Falha ao limpar credenciais.");
      setSettings(result.settings);
      setAdminPassword("");
      setNotice("Credenciais da APIBrasil removidas.");
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Erro ao remover.");
    } finally {
      setSaving(false);
    }
  }

  function updateEndpoint(key: keyof EndpointSettings, value: string) {
    setEndpoints((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="settings-page-panel">
      <div className="settings-page-heading">
        <div>
          <div className="section-kicker">CONEXÃO SEGURA APIBRASIL</div>
          <h2>Credenciais & Endpoints da Conta</h2>
          <p>
            Insira o <strong>Bearer Token</strong> e <strong>Device Token</strong> obtidos no painel da APIBrasil.
            Eles são salvos criptografados com AES-256 no servidor e nunca expostos no navegador.
          </p>
        </div>
        <span className={`report-source ${settings?.configured ? "real-source" : "demo-source"}`}>
          <span />
          {settings?.configured ? "APIBrasil Conectada" : "Pendente"}
        </span>
      </div>

      {busy ? (
        <div className="fipe-loading">
          <span className="button-spinner" />
          Carregando ambiente seguro…
        </div>
      ) : (
        <form className="api-settings-form" onSubmit={(event) => void saveSettings(event)}>
          <div className={`integration-status-box ${settings?.configured ? "active" : "inactive"}`}>
            <span className="integration-status-dot" />
            <div>
              <strong>{settings?.configured ? "Chave APIBrasil Conectada" : "Chave APIBrasil Pendente"}</strong>
              <small>
                {settings?.accountBalance ? `Saldo em Conta: ${settings.accountBalance}` : settings?.hasBearer ? "Bearer Token gravado com criptografia" : "Nenhum token gravado ainda"} · {settings?.hasDevice ? "Device Token configurado" : "Modo sem DeviceToken"}
                {settings?.accountMessage ? ` (${settings.accountMessage})` : ""}
              </small>
            </div>
          </div>

          <div className="settings-secret-grid">
            {settings?.adminConfigured && (
              <label className="settings-field">
                <span>SENHA MESTRA DO SERVIDOR (ARCA_SETTINGS_PASSWORD)</span>
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.currentTarget.value)}
                  autoComplete="current-password"
                  required
                  placeholder="Insira para autorizar a alteração"
                />
              </label>
            )}

            <label className="settings-field">
              <span>APIBRASIL BEARER TOKEN (OBRIGATÓRIO)</span>
              <input
                type="password"
                value={bearerToken}
                onChange={(event) => setBearerToken(event.currentTarget.value)}
                autoComplete="new-password"
                placeholder={settings?.hasBearer ? "•••••••• Bearer Token já gravado (deixe vazio para manter)" : "Cole seu Bearer Token (JWT) aqui"}
              />
              <small style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "2px" }}>
                ✓ Suficiente para consultas por créditos (saldo em conta).
              </small>
            </label>

            <label className="settings-field">
              <span>APIBRASIL DEVICE TOKEN (OPCIONAL)</span>
              <input
                type="password"
                value={deviceToken}
                onChange={(event) => setDeviceToken(event.currentTarget.value)}
                autoComplete="new-password"
                placeholder={settings?.hasDevice ? "•••••••• Device Token gravado (deixe vazio para manter)" : "Opcional (se tiver dispositivo criado no painel)"}
              />
              <small style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "2px" }}>
                Se não tiver DeviceToken criado, deixe em branco. A consulta funcionará via créditos!
              </small>
            </label>

            <label className="settings-field">
              <span>GATEWAY BASE URL (HTTPS)</span>
              <input
                type="url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.currentTarget.value)}
                required
                placeholder="https://gateway.apibrasil.io/api/v2"
              />
              <small style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "2px" }}>
                URL oficial: https://gateway.apibrasil.io/api/v2
              </small>
            </label>
          </div>

          <div className="endpoint-heading">
            <strong>Mapeamento de Endpoints da APIBrasil:</strong>
            <small>Ajuste os caminhos relativos de acordo com a documentação da sua conta:</small>
          </div>

          <div className="endpoint-grid">
            {(
              [
                ["dados", "1. Dados Básicos por Placa (/vehicles/dados)"],
                ["renavam", "2. Dados Básicos por RENAVAM (/vehicles/base/000/dados)"],
                ["multas", "3. Multas e Débitos (/vehicles/multas)"],
                ["roubo", "4. Roubo e Furto (/vehicles/roubo-furto)"],
                ["leilao", "5. Histórico de Leilão (/vehicles/leilao)"],
                ["recall", "6. Recall Pendente (/vehicles/recall)"],
                ["fipe", "7. FIPE APIBrasil (Opcional) (/vehicles/fipe)"],
              ] as Array<[keyof EndpointSettings, string]>
            ).map(([key, label]) => (
              <label className="settings-field endpoint-field" key={key}>
                <span>{label}</span>
                <input value={endpoints[key]} onChange={(event) => updateEndpoint(key, event.currentTarget.value)} required />
              </label>
            ))}
          </div>

          {settings?.updatedAt && (
            <p className="fipe-free-footnote">Última atualização registrada: {formatDate(settings.updatedAt)}</p>
          )}

          {notice && <div className="settings-success">{notice}</div>}
          {error && (
            <div className="inline-alert error-alert">
              <Icon name="alert" size={18} />
              <span>{error}</span>
            </div>
          )}

          <div className="settings-actions">
            <button className="modal-done-button" type="submit" disabled={saving}>
              {saving ? "Salvando com Criptografia…" : "Salvar Configurações APIBrasil"}
              {!saving && <Icon name="check" size={16} />}
            </button>
            {settings?.configured && (
              <button
                className="text-button"
                type="button"
                onClick={() => void clearCredentials()}
                disabled={saving}
              >
                Remover Chaves Salvas
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function ReportView({ report }: { report: ConsultationReport }) {
  const dataAvailable = Boolean(report.vehicle.marcaModelo || report.vehicle.modelo || report.vehicle.marca);
  const fields: Array<[string, string | null]> = [
    ["RENAVAM", report.vehicle.renavam],
    ["Chassi", report.vehicle.chassi],
    ["Motor", report.vehicle.motor],
    ["Ano Fabricação", report.vehicle.anoFabricacao],
    ["Ano Modelo", report.vehicle.anoModelo],
    ["Cor", report.vehicle.cor],
    ["Combustível", report.vehicle.combustivel],
    ["Espécie", report.vehicle.especie],
    ["Tipo", report.vehicle.tipo],
    ["Categoria", report.vehicle.categoria],
    ["Município / UF", [report.vehicle.municipio, report.vehicle.uf].filter(Boolean).join(" / ") || null],
    ["Situação Veículo", report.vehicle.situacao],
    ["Potência", report.vehicle.potencia],
    ["Cilindradas", report.vehicle.cilindradas],
    ["Capacidade", report.vehicle.passageiros ? `${report.vehicle.passageiros} passageiros` : null],
  ];

  const riskCards: Array<{ key: string; title: string; service: OptionalService; section: ProviderSection | null; icon: IconName }> = [];
  if (report.services.roubo) riskCards.push({ key: "roubo", title: "Roubo e Furto", service: "roubo", section: report.rouboFurto, icon: "shield" });
  if (report.services.leilao) riskCards.push({ key: "leilao", title: "Histórico de Leilão", service: "leilao", section: report.leilao, icon: "auction" });
  if (report.services.recall) riskCards.push({ key: "recall", title: "Recall de Montadora", service: "recall", section: report.recall, icon: "wrench" });

  const finesConsulted = report.sources.some((s) => s.includes("Multas"));

  return (
    <section className="report-section" id="resultados" aria-live="polite">
      <div className="report-topline">
        <div>
          <div className="section-kicker">03 · RELATÓRIO DO VEÍCULO</div>
          <h2>
            {report.lookupType === "placa"
              ? `Placa ${displayPlate(report.lookupValue, "auto")}`
              : `RENAVAM ${report.lookupValue}`}
          </h2>
        </div>
        <div className="report-actions">
          <span className={`report-source ${report.mode === "unavailable" ? "demo-source" : "real-source"}`}>
            <span />
            {report.mode === "mixed"
              ? "APIBrasil + FIPE Grátis"
              : report.mode === "apibrasil"
              ? "APIBrasil"
              : report.mode === "public"
              ? "Fontes Públicas"
              : "Sem Dados"}
          </span>
          <button className="icon-button print-button" type="button" onClick={() => window.print()}>
            <Icon name="print" size={16} />
            <span>Imprimir Relatório</span>
          </button>
        </div>
      </div>

      {report.mode === "unavailable" && (
        <div className="report-notice demo-notice">
          <Icon name="info" size={20} />
          <div>
            <strong>Nenhum dado retornado para este identificador</strong>
            <p>{report.demoNotice || "Verifique se a APIBrasil está configurada e com saldo em créditos na aba Configurações."}</p>
          </div>
        </div>
      )}

      {report.warnings.length > 0 && (
        <div className="report-notice partial-notice">
          <Icon name="alert" size={20} />
          <div>
            <strong>Retorno parcial de serviços</strong>
            <p>Algumas fontes não responderam nesta requisição. Os demais dados continuam preservados abaixo.</p>
          </div>
        </div>
      )}

      {/* METADATA BAR */}
      <div className="report-meta">
        <span>
          <Icon name={report.lookupType === "placa" ? "plate" : "search"} size={16} />
          {report.lookupType.toUpperCase()}:{" "}
          <strong>{report.lookupType === "placa" ? displayPlate(report.lookupValue, "auto") : report.lookupValue}</strong>
        </span>
        {report.lookupType === "renavam" && report.plate && (
          <span>
            <Icon name="plate" size={15} />
            Placa vinculada: <strong>{displayPlate(report.plate, "auto")}</strong>
          </span>
        )}
        <span>
          <Icon name="clock" size={15} />
          Consultado em: <strong>{formatDate(report.consultedAt)}</strong>
        </span>
        <span>
          <Icon name="pulse" size={15} />
          Tempo de resposta: <strong>{report.durationMs < 1000 ? `${report.durationMs}ms` : `${(report.durationMs / 1000).toFixed(1)}s`}</strong>
        </span>
      </div>

      {/* SOURCES RESPONDED CHIPS */}
      {report.sources.length > 0 && (
        <div className="source-list">
          <span className="source-list-label">FONTES RESPONDIDAS:</span>
          {report.sources.map((src) => (
            <span className="source-chip" key={src}>
              <Icon name="check" size={12} />
              {src}
            </span>
          ))}
        </div>
      )}

      {/* MAIN VEHICLE & FIPE SPLIT GRID */}
      <div className="report-grid">
        {/* VEHICLE CADASTRO CARD */}
        <article className="report-card vehicle-report-card">
          <div className="report-card-heading">
            <span className="report-card-icon">
              <Icon name="car" size={20} />
            </span>
            <div>
              <h3>Dados Cadastrais do Veículo</h3>
              <p>Retorno oficial da base cadastral</p>
            </div>
          </div>

          <div className="vehicle-summary">
            {report.vehicle.placa && (
              <span className="vehicle-plate-chip">{displayPlate(report.vehicle.placa, "auto")}</span>
            )}
            <strong>
              {report.vehicle.marcaModelo ||
                [report.vehicle.marca, report.vehicle.modelo].filter(Boolean).join(" ") ||
                "Dados Cadastrais"}
            </strong>
          </div>

          <div className="detail-grid">
            {fields
              .filter(([, val]) => val)
              .map(([label, val]) => (
                <DetailItem key={label} label={label} value={val ?? ""} />
              ))}
          </div>

          {!dataAvailable && (
            <div className="no-data-note">
              <Icon name="info" size={16} />
              <span>
                {report.mode === "unavailable"
                  ? "A fonte não respondeu dados para este identificador. Verifique suas credenciais em Configurações."
                  : "Nenhum detalhe adicional de motor/chassi retornado."}
              </span>
            </div>
          )}
        </article>

        {/* FIPE CARD (RESOLVED FOR FREE VIA PARALLELUM OR APIBRASIL) */}
        <article className="report-card fipe-report-card">
          <div className="report-card-heading">
            <span className="report-card-icon fipe-icon">
              <Icon name="chart" size={20} />
            </span>
            <div>
              <h3>Avaliação Tabela FIPE</h3>
              <p>Valor médio de mercado oficial</p>
            </div>
          </div>

          {report.fipe?.valor ? (
            <>
              <div className="fipe-value">{formatMoney(report.fipe.valor)}</div>
              <div className="fipe-reference">
                Mês de Referência: <strong>{report.fipe.mesReferencia || "Referência Vigente"}</strong>
              </div>

              <div className="detail-list">
                <DetailLine label="Código FIPE" value={report.fipe.codigoFipe} />
                <DetailLine label="Modelo FIPE" value={report.fipe.modelo} />
                <DetailLine label="Ano Modelo" value={report.fipe.anoModelo} />
                <DetailLine label="Combustível" value={report.fipe.combustivel} />
              </div>
            </>
          ) : (
            <div className="report-empty">
              <Icon name="chart" size={32} />
              <strong>Tabela FIPE Não Localizada</strong>
              <p>
                O modelo retornado pode possuir variação de nome. Você pode consultar a versão exata no buscador gratuito
                logo abaixo!
              </p>
            </div>
          )}
        </article>
      </div>

      {/* FINES / MULTAS SECTION */}
      {report.services.multas && (
        <article className="report-card fines-report-card">
          <div className="report-card-heading fines-heading">
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span className="report-card-icon">
                <Icon name="ticket" size={20} />
              </span>
              <div>
                <h3>Multas e Infrações</h3>
                <p>Débitos e autuações registradas</p>
              </div>
            </div>

            <div className="fine-total">Total: {formatMoney(report.totalMultas)}</div>
          </div>

          {report.multas.length > 0 ? (
            <div className="fine-list">
              {report.multas.slice(0, 30).map((fine, idx) => (
                <div className="fine-row" key={`${fine.ait ?? "m"}-${idx}`}>
                  <div className="fine-index">{String(idx + 1).padStart(2, "0")}</div>
                  <div className="fine-copy">
                    <strong>{fine.descricao}</strong>
                    <span>
                      {[fine.ait ? `AIT: ${fine.ait}` : null, fine.dataHora, fine.local, fine.orgao]
                        .filter(Boolean)
                        .join(" · ") || "Detalhes adicionais não informados"}
                    </span>
                    {fine.status && <small>{fine.status}</small>}
                  </div>
                  <strong className="fine-amount">
                    {fine.valorDevido !== null ? formatMoney(fine.valorDevido) : fine.valor !== null ? formatMoney(fine.valor) : "—"}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="report-empty inline-empty">
              <Icon name="ticket" size={24} />
              <strong>{finesConsulted ? "Nenhuma multa em aberto" : "Serviço de multas sem resposta"}</strong>
              <p>
                {finesConsulted
                  ? "Nenhum auto de infração pendente retornado pelo Detran para este veículo."
                  : "Verifique seu saldo e o endpoint configurado na aba Configurações."}
              </p>
            </div>
          )}

          <div className="fines-disclaimer">
            Os débitos exibidos correspondem às informações retornadas pelas bases estaduais e não substituem certidão negativa oficial.
          </div>
        </article>
      )}

      {/* RISK CARDS (ROUBO/FURTO, LEILÃO, RECALL) */}
      {riskCards.length > 0 && (
        <div className="risk-results-grid">
          {riskCards.map((card) => (
            <ProviderResultCard
              key={card.key}
              title={card.title}
              section={card.section}
              icon={card.icon}
              consulted={report.sources.some((s) => s.includes(card.title))}
            />
          ))}
        </div>
      )}

      {/* NOVOS SERVIÇOS — CSV, GRAVAME, DÉBITOS, CRLV, SCORE */}
      {report.csvCompleta && (() => {
        const csv = report.csvCompleta;
        const restricoes = csv.restricoes ?? [];
        const renajud = csv.renajud?.ocorrencias ?? [];
        const renainf = csv.renainf?.ocorrencias ?? [];
        const proprietario = csv.bin?.proprietario;
        return (
          <article className="report-card csv-report-card">
            <div className="report-card-heading">
              <span className="report-card-icon"><Icon name="doc" size={20} /></span>
              <div><h3>CSV Completa</h3><p>RENAINF + RENAJUD + BIN nacional</p></div>
            </div>
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
              <div className="csv-owner">Proprietário: <strong>{proprietario.nome}</strong></div>
            )}
          </article>
        );
      })()}

      {report.gravame && (
        <ProviderResultCard title="Gravame" section={report.gravame} icon="lock" consulted={report.sources.some((s) => s.includes("Gravame"))} />
      )}

      {report.debitos && (report.debitos.pdf || report.debitos.valor) && (
        <article className="report-card debitos-report-card">
          <div className="report-card-heading">
            <span className="report-card-icon"><Icon name="boleto" size={20} /></span>
            <div><h3>Débitos Veiculares</h3><p>Boleto para pagamento</p></div>
          </div>
          {report.debitos.valor ? <div className="debitos-valor">Valor: {formatMoney(report.debitos.valor)}</div> : null}
          {report.debitos.pdf && (
            <a className="client-pdf-link" href={report.debitos.pdf} target="_blank" rel="noopener noreferrer">Abrir boleto em PDF</a>
          )}
          {report.debitos.msg && <small className="debitos-msg">{report.debitos.msg}</small>}
        </article>
      )}

      {report.crlv?.pdf && (
        <article className="report-card crlv-report-card">
          <div className="report-card-heading">
            <span className="report-card-icon"><Icon name="doc" size={20} /></span>
            <div><h3>Documento CRLV</h3><p>Emissão em PDF</p></div>
          </div>
          <a className="client-pdf-link" href={report.crlv.pdf} target="_blank" rel="noopener noreferrer">Baixar CRLV em PDF {report.crlv.uf ? `(${report.crlv.uf})` : ""}</a>
        </article>
      )}

      {report.score && (report.score.score || report.score.nome) && (
        <article className="report-card score-report-card">
          <div className="report-card-heading">
            <span className="report-card-icon"><Icon name="score" size={20} /></span>
            <div><h3>Score de Crédito</h3><p>Acerta Essencial</p></div>
          </div>
          <div className="score-details">
            {report.score.nome && <div className="score-name">{report.score.nome}</div>}
            {report.score.score && <div className="score-value">{report.score.score}</div>}
            {report.score.probabilidade && <small>Probabilidade: {report.score.probabilidade}</small>}
            {report.score.situacao && <small>Situação: {report.score.situacao}</small>}
            {report.score.renda && <small>Renda presumida: {report.score.renda}</small>}
            {report.score.mensagem && <p className="score-msg">{report.score.mensagem}</p>}
          </div>
        </article>
      )}

      {/* WARNINGS */}
      {report.warnings.length > 0 && (
        <div className="warning-list">
          <strong>Avisos de Fontes:</strong>
          {report.warnings.map((w) => (
            <div key={w.service}>
              • <strong>{w.service}:</strong> {w.message}
            </div>
          ))}
        </div>
      )}

      <div className="report-privacy-note">
        <Icon name="lock" size={14} />
        <span>
          O histórico deste navegador registra apenas placa, RENAVAM, status e data. Os dados detalhados não são gravados em banco.
        </span>
      </div>
    </section>
  );
}

function ProviderResultCard({
  title,
  section,
  icon,
  consulted,
}: {
  title: string;
  section: ProviderSection | null;
  icon: IconName;
  consulted: boolean;
}) {
  const statusLabel =
    section?.state === "alert"
      ? "Alerta / Consta Registro"
      : section?.state === "clear"
      ? "Nada Consta"
      : "Inconclusivo / Não Localizado";

  return (
    <article className="report-card provider-card">
      <div className="report-card-heading">
        <span className="report-card-icon">
          <Icon name={icon} size={18} />
        </span>
        <div>
          <h3>{title}</h3>
          <p>Verificação complementar</p>
        </div>
      </div>

      {section ? (
        <>
          <div className={`provider-state state-${section.state}`}>
            <span />
            {statusLabel}
          </div>

          {section.headline && <p className="provider-headline">{section.headline}</p>}

          {section.items.length > 0 ? (
            <div className="detail-list">
              {section.items.map((item) => (
                <DetailLine key={item.label} label={item.label} value={item.value} />
              ))}
            </div>
          ) : (
            <p className="provider-empty">Sem detalhes adicionais estruturados.</p>
          )}
        </>
      ) : (
        <div className="report-empty compact-empty">
          <strong>{consulted ? "Sem registros" : "Não consultado"}</strong>
          <p>{consulted ? "A base não apontou restrições." : "Ative as credenciais na aba Configurações."}</p>
        </div>
      )}
    </article>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="detail-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function displayPlate(value: string, format: PlateFormatSelection): string {
  const plate = convertPlateFormat(normalizePlate(value), format);
  return getPlateFormat(plate) === "antiga" && plate.length === 7
    ? `${plate.slice(0, 3)}-${plate.slice(3)}`
    : plate;
}

function tabTitle(tab: ActiveTab): string {
  switch (tab) {
    case "consulta":
      return "Consulta Veicular Integrada";
    case "historico":
      return "Histórico de Pesquisas";
    case "configuracoes":
      return "Configuração de Chaves APIBrasil";
    case "precificacao":
      return "Precificação e Pagamento PIX";
    case "pedidos":
      return "Pedidos e Confirmação de Pagamento";
    case "cliente":
      return "Aplicativo do Cliente";
    case "provedores":
      return "Comparativo de Provedores Veiculares";
  }
}

function serviceSummary(services: ServiceSelection): string {
  const selected = serviceOptions.filter((opt) => services[opt.key]).map((opt) => opt.name);
  return selected.length ? selected.join(", ") : "Consulta Básica";
}

function historySource(source: ConsultationHistoryEntry["source"]): string {
  switch (source) {
    case "public":
      return "Fonte Pública";
    case "mixed":
      return "APIBrasil + FIPE";
    case "apibrasil":
      return "APIBrasil";
    case "unavailable":
      return "Sem Resposta";
    case "demo":
      return "Demonstração";
  }
}

function historyStatus(status: ConsultationHistoryEntry["status"]): string {
  switch (status) {
    case "success":
      return "Sucesso";
    case "partial":
      return "Parcial";
    case "error":
      return "Erro";
    case "unavailable":
      return "Indisponível";
    case "demo":
      return "Demonstração";
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatMoney(value: string | number): string {
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : "—";
  }
  const original = value.trim();
  let normalized = original.replace(/[^\d,.-]/g, "");
  if (normalized.includes(",")) normalized = normalized.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return normalized && Number.isFinite(parsed)
    ? parsed.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : original || "—";
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
    case "history":
      return (
        <svg {...shared}>
          <path d="M3.5 12a8.5 8.5 0 1 0 2.4-5.9L3.5 8.5" />
          <path d="M3.5 4.5v4h4M12 7.5V12l3 2" />
        </svg>
      );
    case "shield":
      return (
        <svg {...shared}>
          <path d="M12 3 19 6v5.2c0 4.3-2.9 7.7-7 9.8-4.1-2.1-7-5.5-7-9.8V6z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...shared}>
          <circle cx="12" cy="12" r="3" />
          <path
            d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1A1.7 1.7 0 0 0 4.2 12h-.2a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2v-.2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2z"
            transform="translate(-1 -1) scale(.92)"
          />
        </svg>
      );
    case "chevron":
      return (
        <svg {...shared}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...shared}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case "check":
      return (
        <svg {...shared}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );
    case "ticket":
      return (
        <svg {...shared}>
          <path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z" />
          <path d="M13 7v2M13 12v1M13 16v1" />
        </svg>
      );
    case "auction":
      return (
        <svg {...shared}>
          <path d="m14 5 5 5M12 7l5 5M4 20h16M6 17h12M8 14l6-6 3 3-6 6zM5 11l3-3 2 2-3 3z" />
        </svg>
      );
    case "wrench":
      return (
        <svg {...shared}>
          <path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4l-3 3-3-3z" />
        </svg>
      );
    case "chart":
      return (
        <svg {...shared}>
          <path d="M4 19V5M4 19h16" />
          <path d="m7 15 4-4 3 2 5-6" />
          <path d="M16 7h3v3" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...shared}>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3v4M16 3v4M4 10h16M8 14h2M14 14h2" />
        </svg>
      );
    case "pulse":
      return (
        <svg {...shared}>
          <path d="M3 12h4l2.5-7 5 14 2.5-7h4" />
        </svg>
      );
    case "lock":
      return (
        <svg {...shared}>
          <rect x="5" y="10" width="14" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 1 1 8 0v3M12 14v3" />
        </svg>
      );
    case "spark":
      return (
        <svg {...shared}>
          <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
          <path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
        </svg>
      );
    case "dots":
      return (
        <svg {...shared}>
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </svg>
      );
    case "trash":
      return (
        <svg {...shared}>
          <path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 14h11l1-14M9 7V4h6v3" />
        </svg>
      );
    case "print":
      return (
        <svg {...shared}>
          <path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
          <path d="M7 14h10v7H7z" />
        </svg>
      );
    case "clock":
      return (
        <svg {...shared}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "plate":
      return (
        <svg {...shared}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M7 10h2M11 10h2M15 10h2M7 14h10" />
        </svg>
      );
    case "alert":
      return (
        <svg {...shared}>
          <path d="M12 3 2.8 19h18.4z" />
          <path d="M12 9v4M12 16h.01" />
        </svg>
      );
    case "info":
      return (
        <svg {...shared}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      );
    case "close":
      return (
        <svg {...shared}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
    case "doc":
      return (
        <svg {...shared}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
        </svg>
      );
    case "boleto":
      return (
        <svg {...shared}>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20M6 15h4" />
        </svg>
      );
    case "score":
      return (
        <svg {...shared}>
          <path d="M3 3v18h18" />
          <path d="m7 14 4-4 3 3 5-6" />
          <circle cx="19" cy="7" r="2" />
        </svg>
      );
  }
}

type IconName =
  | "car"
  | "search"
  | "history"
  | "shield"
  | "settings"
  | "chevron"
  | "arrow"
  | "check"
  | "ticket"
  | "auction"
  | "wrench"
  | "chart"
  | "calendar"
  | "pulse"
  | "lock"
  | "spark"
  | "dots"
  | "trash"
  | "print"
  | "clock"
  | "plate"
  | "alert"
  | "info"
  | "close"
  | "doc"
  | "boleto"
  | "score";
