"use client";

import { useEffect, useId, useState } from "react";
import { Search, X } from "lucide-react";
import { normalize } from "@/lib/catalog";
import { modelLabel } from "@/lib/device-tiles";

export default function ModelPicker({ models, value, onChange, brand = "", label = "Model uređaja" }: {
  models: string[];
  value: string;
  onChange: (model: string) => void;
  brand?: string;
  label?: string;
}) {
  const display = (model: string) => modelLabel(brand, model);
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => { if (value) setText(display(value)); }, [value, brand]);
  const query = normalize(text.trim());
  const matches = query
    ? models.filter((model) => normalize(display(model)).includes(query) || normalize(model).includes(query))
      .sort((a, b) => {
        const rank = (model: string) => normalize(model) === query ? 0 : normalize(display(model)).startsWith(query) ? 1 : normalize(display(model)).includes(query) ? 2 : 3;
        return rank(a) - rank(b) || a.localeCompare(b, "sr-Latn-RS");
      }).slice(0, 8)
    : [];
  const choose = (model: string) => {
    setText(display(model));
    onChange(model);
    setOpen(false);
  };
  return <div className="model-picker" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <div className="model-picker-input">
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        aria-label={`Pretraži ${label.toLocaleLowerCase("sr-Latn-RS")}`}
        aria-controls={id}
        autoComplete="off"
        placeholder="Ukucaj model, npr. A54"
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          if (value) onChange("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" && open && matches.length) {
            event.preventDefault();
            choose(matches.find((model) => normalize(model) === query) || matches[0]);
          }
        }}
      />
      {value && <button type="button" aria-label="Ukloni izabrani model" onClick={() => { setText(""); onChange(""); setOpen(false); }}><X size={15} /></button>}
    </div>
    {open && query && <div id={id} className="model-picker-results">
      {matches.length ? matches.map((model) => <button key={model} type="button" onClick={() => choose(model)}>{display(model)}</button>)
        : <span>Nema modela za „{text}”.</span>}
    </div>}
    {value && <small>Izabrani model: <strong>{display(value)}</strong></small>}
  </div>;
}
