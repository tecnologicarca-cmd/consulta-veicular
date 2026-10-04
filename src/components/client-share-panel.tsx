"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatCentsToReal } from "@/lib/pix";

interface ShareOption {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: ReactNode;
  action: (url: string, text: string) => void;
}

export default function ClientSharePanel() {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [settings, setSettings] = useState<{
    markupPercent?: string;
    pixProvider?: string;
    paymentConfigured?: boolean;
    freeLookupEnabled?: boolean;
  } | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    void fetch("/api/pricing", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) {
          setSettings({
            markupPercent: data.settings?.markupPercent,
            pixProvider: data.settings?.pixProvider,
            paymentConfigured: data.paymentConfigured,
            freeLookupEnabled: data.freeLookupEnabled,
          });
        }
      })
      .catch(() => null);
  }, []);

  const clientUrl = `${origin}/app`;
  const shareText = "🚗 Consulte informações veiculares por placa de forma rápida e segura!";
  const shareTextWithUrl = `${shareText}\n${clientUrl}`;

  const shareOptions: ShareOption[] = [
    {
      id: "whatsapp",
      name: "WhatsApp",
      description: "Envie direto para um contato ou grupo",
      color: "#25d366",
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.414-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      ),
      action: (url, text) => {
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
        void url;
      },
    },
    {
      id: "telegram",
      name: "Telegram",
      description: "Compartilhe em chats ou canais",
      color: "#0088cc",
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
      ),
      action: (url, text) => {
        window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
      },
    },
    {
      id: "facebook",
      name: "Facebook",
      description: "Publique na sua página ou perfil",
      color: "#1877f2",
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      ),
      action: (url) => {
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, "_blank", "noopener,noreferrer");
      },
    },
    {
      id: "instagram",
      name: "Instagram",
      description: "Copie o link e cole no story ou direct",
      color: "#e4405f",
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.9.423.423.682.82.9 1.382.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.9 1.382-.419.423-.824.682-1.38.9-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.9-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678a6.162 6.162 0 100 12.324 6.162 6.162 0 100-12.324zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405a1.441 1.441 0 01-2.88 0 1.44 1.44 0 012.88 0z" />
        </svg>
      ),
      action: (url) => {
        void navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2_400);
      },
    },
  ];

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(clientUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="settings-page-panel client-share-panel">
      <div className="settings-page-heading">
        <div>
          <div className="section-kicker">DIVULGAÇÃO</div>
          <h2>App do Cliente</h2>
          <p>Compartilhe o link do aplicativo com seus clientes pelas redes sociais.</p>
        </div>
        <span className="report-source real-source">
          <span />Disponível
        </span>
      </div>

      <div className="client-link-preview">
        <div className="client-link-header">
          <div className="client-link-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 11 1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11" />
              <path d="M3.5 11.5A2.5 2.5 0 0 1 6 9h12a2.5 2.5 0 0 1 2.5 2.5V18H3.5z" />
              <path d="M3.5 14h17M7 18v1.5M17 18v1.5M7 13h.01M17 13h.01" />
            </svg>
          </div>
          <div>
            <strong>Arca Consultas Veiculares</strong>
            <small>Consulta por placa ou RENAVAM com pagamento via PIX</small>
          </div>
        </div>
        <div className="client-link-url">
          <code>{clientUrl || "carregando…"}</code>
          <button type="button" className="link-copy-button" onClick={() => void copyLink()}>
            {copied ? "Copiado!" : "Copiar link"}
          </button>
        </div>
        <a className="client-open-button" href="/app" target="_blank" rel="noopener noreferrer">
          Abrir aplicativo do cliente
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <path d="M15 3h6v6M10 14 21 3" />
          </svg>
        </a>
      </div>

      <div className="share-section">
        <div className="share-heading">
          <strong>Compartilhar nas redes sociais</strong>
          <small>Clique em uma das opções abaixo para divulgar</small>
        </div>
        <div className="share-grid">
          {shareOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className="share-card"
              style={{ "--share-color": option.color } as React.CSSProperties}
              onClick={() => option.action(clientUrl, shareTextWithUrl)}
            >
              <span className="share-card-icon">{option.icon}</span>
              <span className="share-card-text">
                <strong>{option.name}</strong>
                <small>{option.description}</small>
              </span>
              <span className="share-card-arrow">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            </button>
          ))}
        </div>
      </div>

      {settings && (
        <div className="share-settings-summary">
          <div className="share-summary-item">
            <span>Markup aplicado</span>
            <strong>{settings.markupPercent ?? "40"}%</strong>
          </div>
          <div className="share-summary-item">
            <span>Forma de pagamento</span>
            <strong>{settings.pixProvider === "mercadopago" ? "Mercado Pago" : "PIX Manual"}</strong>
          </div>
          <div className="share-summary-item">
            <span>Status</span>
            <strong className={settings.paymentConfigured ? "ready" : "pending"}>
              {settings.paymentConfigured ? "Pronto para vender" : "Configure o PIX"}
            </strong>
          </div>
        </div>
      )}

      <div className="share-tips">
        <div className="share-tip">
          <span className="tip-icon">💬</span>
          <div>
            <strong>Mensagem pronta para WhatsApp</strong>
            <p>"{shareText} {clientUrl}"</p>
          </div>
        </div>
        <div className="share-tip">
          <span className="tip-icon">📸</span>
          <div>
            <strong>Dica para Instagram</strong>
            <p>Cole o link no story ou direct. O cliente abre e consulta na hora.</p>
          </div>
        </div>
        <div className="share-tip">
          <span className="tip-icon">✈️</span>
          <div>
            <strong>Dica para Telegram</strong>
            <p>Ideal para grupos de compra e venda de veículos.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
