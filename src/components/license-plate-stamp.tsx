"use client";

import { useRef } from "react";
import {
  convertPlateFormat,
  getPlateFormat,
  normalizePlate,
  normalizeRenavam,
  type PlateFormat,
  type PlateFormatSelection,
} from "@/lib/vehicles";

interface LicensePlateStampProps {
  value: string;
  lookupType: "placa" | "renavam";
  preference: PlateFormatSelection;
  city?: string | null;
  uf?: string | null;
  onChangePreference?: (format: PlateFormatSelection) => void;
  onDirectChange?: (val: string) => void;
  onSubmitDirect?: () => void;
  disabled?: boolean;
}

export default function LicensePlateStamp({
  value,
  lookupType,
  preference,
  city,
  uf,
  onChangePreference,
  onDirectChange,
  onSubmitDirect,
  disabled = false,
}: LicensePlateStampProps) {
  const plateInputRef = useRef<HTMLInputElement>(null);
  const renavamInputRef = useRef<HTMLInputElement>(null);

  // RENAVAM MODE — Type directly inside the styled certificate card
  if (lookupType === "renavam") {
    const rawDigits = normalizeRenavam(value);

    return (
      <div className="plate-showcase-container">
        <div
          className="stamped-renavam-card interactive-renavam-card"
          onClick={() => renavamInputRef.current?.focus()}
          role="region"
          aria-label="Digitação direta no documento RENAVAM"
        >
          <div className="renavam-card-header">
            <div className="renavam-coat-emblem">🏛️</div>
            <div className="renavam-card-title">
              <strong>REPÚBLICA FEDERATIVA DO BRASIL</strong>
              <small>REGISTRO NACIONAL DE VEÍCULOS AUTOMOTORES · SENATRAN</small>
            </div>
            <div className="renavam-cert-tag">CRLV-e DIGITAL</div>
          </div>

          <div className="renavam-card-body">
            <div className="renavam-serial-box">
              <span className="renavam-watermark">DIGITE DIRETAMENTE O RENAVAM (9 OU 11 DÍGITOS)</span>
              <input
                ref={renavamInputRef}
                type="text"
                inputMode="numeric"
                className="renavam-direct-input"
                value={rawDigits}
                onChange={(e) => onDirectChange?.(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onSubmitDirect?.();
                  }
                }}
                placeholder="01234567890"
                maxLength={11}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
                aria-label="Código RENAVAM"
              />
              <span className="renavam-counter-pill">{rawDigits.length}/11 dígitos</span>
            </div>

            <div className="renavam-barcode-strip" aria-hidden="true">
              <span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // PLATE MODE — Type directly inside the realistic stamped license plate!
  const normalized = normalizePlate(value);
  const detectedFormat = getPlateFormat(normalized);
  const activeFormat: PlateFormat =
    preference === "auto"
      ? detectedFormat ?? (normalized.length > 4 && /[A-J]/.test(normalized[4]) ? "mercosul" : "antiga")
      : preference;

  const targetConverted = convertPlateFormat(normalized, activeFormat);
  const isMercosul = activeFormat === "mercosul";
  const locationLabel = [city, uf].filter(Boolean).join(" - ") || "BRASIL";

  // Display formatting with hyphen for old pattern
  const formattedValue =
    activeFormat === "antiga" && targetConverted.length >= 4
      ? `${targetConverted.slice(0, 3)}-${targetConverted.slice(3, 7)}`
      : targetConverted;

  const placeholderText = activeFormat === "antiga" ? "ABC-1234" : "ABC1C34";

  return (
    <div className="plate-showcase-container">
      {onChangePreference && (
        <div className="plate-format-selector-bar" role="group" aria-label="Selecione o padrão visual da placa">
          <button
            type="button"
            className={`plate-type-pill ${preference === "auto" ? "active" : ""}`}
            onClick={() => onChangePreference("auto")}
          >
            Auto {detectedFormat ? `(${detectedFormat === "mercosul" ? "Mercosul" : "Antiga"})` : ""}
          </button>
          <button
            type="button"
            className={`plate-type-pill ${preference === "mercosul" ? "active" : ""}`}
            onClick={() => onChangePreference("mercosul")}
          >
            <span className="pill-flag">🇧🇷</span> Mercosul (Padrão Atual)
          </button>
          <button
            type="button"
            className={`plate-type-pill ${preference === "antiga" ? "active" : ""}`}
            onClick={() => onChangePreference("antiga")}
          >
            <span className="pill-metal" /> Antiga (Cinza Tradicional)
          </button>
        </div>
      )}

      {/* CLICKABLE/FOCUSABLE REALISTIC EMBOSSED PLATE */}
      <div
        className={`stamped-plate interactive-plate ${isMercosul ? "is-mercosul" : "is-antiga"}`}
        onClick={() => plateInputRef.current?.focus()}
        role="region"
        aria-label={`Placa estampada ${isMercosul ? "Mercosul" : "Antiga"}. Digite diretamente na placa.`}
      >
        <div className="plate-embossed-rim">
          {isMercosul ? (
            <>
              <div className="mercosul-header-stripe">
                <div className="mercosul-constellation" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <div className="mercosul-country-name">BRASIL</div>
                <div className="mercosul-flag-box" aria-hidden="true">
                  <div className="flag-green">
                    <div className="flag-yellow">
                      <div className="flag-blue" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="plate-body-surface">
                <input
                  ref={plateInputRef}
                  type="text"
                  className="plate-direct-input mercosul-font"
                  value={formattedValue}
                  onChange={(e) => onDirectChange?.(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onSubmitDirect?.();
                    }
                  }}
                  placeholder={placeholderText}
                  maxLength={8}
                  disabled={disabled}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-label="Placa do veículo Mercosul"
                />
                <div className="mercosul-hologram-seal">BR</div>
              </div>
            </>
          ) : (
            <>
              <div className="antiga-header-band">
                <div className="metallic-rivet rivet-left" aria-hidden="true" />
                <span className="antiga-location-stamp">{locationLabel}</span>
                <div className="metallic-rivet rivet-right" aria-hidden="true" />
              </div>

              <div className="plate-body-surface antiga-surface">
                <input
                  ref={plateInputRef}
                  type="text"
                  className="plate-direct-input antiga-font"
                  value={formattedValue}
                  onChange={(e) => onDirectChange?.(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onSubmitDirect?.();
                    }
                  }}
                  placeholder={placeholderText}
                  maxLength={8}
                  disabled={disabled}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-label="Placa do veículo Antiga"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
