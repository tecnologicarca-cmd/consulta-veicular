"use client";

import { useMemo, useState } from "react";

type VehicleKind = "cars" | "motorcycles" | "trucks";
type FipeOption = { code: string; name: string };
type FipePrice = {
  price?: string;
  brand?: string;
  model?: string;
  modelYear?: number | string;
  fuel?: string;
  codeFipe?: string;
  referenceMonth?: string;
};

export default function FreeFipeSearch() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<VehicleKind>("cars");
  const [brands, setBrands] = useState<FipeOption[]>([]);
  const [models, setModels] = useState<FipeOption[]>([]);
  const [years, setYears] = useState<FipeOption[]>([]);
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [search, setSearch] = useState("");
  const [price, setPrice] = useState<FipePrice | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");

  const filteredModels = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("pt-BR");
    return needle
      ? models.filter((item) => item.name.toLocaleLowerCase("pt-BR").includes(needle))
      : models;
  }, [models, search]);

  async function fetchJson<T>(params: Record<string, string>): Promise<T> {
    const query = new URLSearchParams(params);
    const response = await fetch(`/api/fipe?${query.toString()}`, { cache: "no-store" });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = objectValue(payload, "error");
      throw new Error(typeof message === "string" ? message : "A consulta FIPE não pôde ser concluída.");
    }
    return payload as T;
  }

  async function loadBrands(nextKind: VehicleKind) {
    setLoading("Carregando marcas…");
    setError("");
    try {
      const result = await fetchJson<unknown>({ kind: nextKind, resource: "brands" });
      setBrands(toOptions(result));
    } catch (caught) {
      setBrands([]);
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar as marcas FIPE.");
    } finally {
      setLoading("");
    }
  }

  async function handleOpen() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && brands.length === 0) await loadBrands(kind);
  }

  async function handleKindChange(nextKind: VehicleKind) {
    setKind(nextKind);
    setBrands([]);
    setModels([]);
    setYears([]);
    setBrand("");
    setModel("");
    setYear("");
    setSearch("");
    setPrice(null);
    await loadBrands(nextKind);
  }

  async function handleBrandChange(value: string) {
    setBrand(value);
    setModel("");
    setYear("");
    setYears([]);
    setSearch("");
    setPrice(null);
    if (!value) {
      setModels([]);
      return;
    }
    setLoading("Carregando modelos…");
    setError("");
    try {
      const result = await fetchJson<unknown>({ kind, resource: "models", brand: value });
      setModels(toOptions(result));
    } catch (caught) {
      setModels([]);
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar os modelos.");
    } finally {
      setLoading("");
    }
  }

  async function handleModelChange(value: string) {
    setModel(value);
    setYear("");
    setPrice(null);
    if (!brand || !value) {
      setYears([]);
      return;
    }
    setLoading("Carregando anos e versões…");
    setError("");
    try {
      const result = await fetchJson<unknown>({ kind, resource: "years", brand, model: value });
      setYears(toOptions(result));
    } catch (caught) {
      setYears([]);
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar os anos e versões.");
    } finally {
      setLoading("");
    }
  }

  async function consultPrice() {
    if (!brand || !model || !year || busy) return;
    setBusy(true);
    setPrice(null);
    setError("");
    try {
      const result = await fetchJson<FipePrice>({ kind, resource: "price", brand, model, year });
      if (!result.price) throw new Error("A FIPE não retornou um valor para essa versão.");
      setPrice(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível consultar este preço FIPE.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`free-fipe-panel ${open ? "is-open" : ""}`} id="fipe-gratis">
      <button className="free-fipe-toggle" type="button" onClick={() => void handleOpen()} aria-expanded={open} aria-controls="free-fipe-content">
        <span className="free-fipe-icon" aria-hidden="true">F</span>
        <span className="free-fipe-heading"><strong>Consultar Tabela FIPE gratuitamente</strong><small>Selecione marca, modelo e ano — esta fonte pública não pesquisa diretamente pela placa.</small></span>
        <span className="free-fipe-toggle-label">{open ? "Fechar" : "Abrir"}</span>
        <span className={`free-fipe-chevron ${open ? "expanded" : ""}`} aria-hidden="true">⌄</span>
      </button>

      {open && <div className="free-fipe-content" id="free-fipe-content">
        <div className="fipe-public-note"><span aria-hidden="true">i</span><p>Esta é a alternativa gratuita que funciona sem credenciais: a API pública FIPE busca por veículo/versão, não por placa. Os dados são uma referência mensal de preço médio.</p></div>
        <div className="fipe-search-grid">
          <label className="fipe-field"><span>TIPO DE VEÍCULO</span><select value={kind} onChange={(event) => void handleKindChange(event.currentTarget.value as VehicleKind)}><option value="cars">Carros e utilitários</option><option value="motorcycles">Motos</option><option value="trucks">Caminhões</option></select></label>
          <label className="fipe-field"><span>MARCA</span><select value={brand} onChange={(event) => void handleBrandChange(event.currentTarget.value)} disabled={brands.length === 0 || Boolean(loading && loading !== "Carregando marcas…")}><option value="">Selecione a marca…</option>{brands.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          <label className="fipe-field"><span>FILTRAR MODELO</span><input value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Ex.: Corolla, Gol, CG…" disabled={!brand || models.length === 0} /></label>
          <label className="fipe-field"><span>MODELO / VERSÃO</span><select value={model} onChange={(event) => void handleModelChange(event.currentTarget.value)} disabled={!brand || models.length === 0}><option value="">{brand ? "Selecione o modelo…" : "Selecione uma marca primeiro"}</option>{filteredModels.slice(0, 500).map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          <label className="fipe-field"><span>ANO / COMBUSTÍVEL</span><select value={year} onChange={(event) => { setYear(event.currentTarget.value); setPrice(null); }} disabled={!model || years.length === 0}><option value="">{model ? "Selecione o ano e combustível…" : "Selecione o modelo primeiro"}</option>{years.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          <div className="fipe-search-action"><button className="fipe-consult-button" type="button" onClick={() => void consultPrice()} disabled={!brand || !model || !year || busy}>{busy ? "Consultando…" : "Consultar preço FIPE"}<span aria-hidden="true">→</span></button></div>
        </div>
        {loading && <div className="fipe-loading" role="status"><span className="button-spinner" />{loading}</div>}
        {error && <div className="fipe-error" role="alert">{error}</div>}
        {price && <div className="fipe-free-result" aria-live="polite"><div className="fipe-result-main"><span>VALOR FIPE · REFERÊNCIA PÚBLICA</span><strong>{price.price}</strong><small>{[price.brand, price.model, price.modelYear, price.fuel].filter(Boolean).join(" · ")}</small></div><div className="fipe-result-meta"><span>Código FIPE<strong>{price.codeFipe || "—"}</strong></span><span>Mês de referência<strong>{price.referenceMonth || "—"}</strong></span></div></div>}
        <p className="fipe-free-footnote">Fonte: FIPE API v2 (Parallelum). Limite público informado pelo mantenedor: 500 requisições/dia sem token; preços devem ser conferidos na referência e não substituem avaliação de mercado.</p>
      </div>}
    </section>
  );
}

function toOptions(value: unknown): FipeOption[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(objectValue(value, "brands"))
      ? objectValue(value, "brands")
      : Array.isArray(objectValue(value, "models"))
        ? objectValue(value, "models")
        : Array.isArray(objectValue(value, "years"))
          ? objectValue(value, "years")
          : Array.isArray(objectValue(value, "data"))
            ? objectValue(value, "data")
            : [];
  return (list as unknown[]).flatMap((item) => {
    if (item === null || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const code = record.code ?? record.id ?? record.codigo;
    const name = record.name ?? record.nome ?? record.modelo ?? record.label;
    if (code === null || code === undefined || name === null || name === undefined) return [];
    return [{ code: String(code), name: String(name) }];
  });
}

function objectValue(value: unknown, key: string): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return (value as Record<string, unknown>)[key];
  }
  return undefined;
}
