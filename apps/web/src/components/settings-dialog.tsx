"use client";

import { useState, useEffect } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

export type LLMConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
};

const STORAGE_KEY = "meshsearch-llm-config";
const DEFAULTS: LLMConfig = { apiKey: "", baseURL: "", model: "" };

export function loadLLMConfig(): LLMConfig {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function saveLLMConfig(config: LLMConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<LLMConfig>(DEFAULTS);

  useEffect(() => {
    setConfig(loadLLMConfig());
  }, [open]);

  const handleSave = () => {
    saveLLMConfig(config);
    setOpen(false);
  };

  const hasConfig = config.apiKey || config.baseURL || config.model;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Settings className="h-4 w-4" />
          {hasConfig && (
            <div className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>LLM Settings</DialogTitle>
          <DialogDescription>
            Configure your OpenAI-compatible endpoint. Leave fields empty to use
            server defaults (.env).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="baseURL">API Base URL</Label>
            <Input
              id="baseURL"
              placeholder="https://api.openai.com/v1"
              value={config.baseURL}
              onChange={(e) =>
                setConfig((c) => ({ ...c, baseURL: e.target.value }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Any OpenAI-compatible endpoint (OpenRouter, Ollama, etc.)
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              placeholder="sk-..."
              value={config.apiKey}
              onChange={(e) =>
                setConfig((c) => ({ ...c, apiKey: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              placeholder="gpt-4o-mini"
              value={config.model}
              onChange={(e) =>
                setConfig((c) => ({ ...c, model: e.target.value }))
              }
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setConfig(DEFAULTS);
                saveLLMConfig(DEFAULTS);
              }}
            >
              Reset
            </Button>
            <Button size="sm" onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
