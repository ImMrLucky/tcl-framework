# spectral_config_loader.py

from __future__ import annotations

from dataclasses import asdict
from typing import Any, Dict, Optional

from .spectral_config import SpectralConfig


def build_spectral_config(overrides: Optional[Dict[str, Any]]) -> SpectralConfig:
    """
    Build SpectralConfig from partial overrides. Invalid values are ignored (fallback to defaults).
    Must not throw; instead return defaults + allow diagnostics to record warnings upstream.
    """
    cfg = SpectralConfig()
    if not overrides:
        return cfg

    base = asdict(cfg)
    merged = dict(base)

    for k, v in overrides.items():
        if k not in base:
            continue
        merged[k] = v

    # Basic validation / coercion (non-throwing)

    def _pos_num(x, default):
        try:
            x = float(x)
            return x if x >= 0.0 else default
        except Exception:
            return default

    def _pos_int(x, default):
        try:
            x = int(x)
            return x if x >= 0 else default
        except Exception:
            return default

    merged["w_support"] = _pos_num(merged["w_support"], cfg.w_support)
    merged["w_contradiction"] = _pos_num(merged["w_contradiction"], cfg.w_contradiction)
    merged["w_circularity"] = _pos_num(merged["w_circularity"], cfg.w_circularity)

    merged["cycle_max_len"] = max(2, _pos_int(merged["cycle_max_len"], cfg.cycle_max_len))
    merged["cycle_decay"] = _pos_num(merged["cycle_decay"], cfg.cycle_decay)

    # heat_t_values must be >0 floats
    heat = merged.get("heat_t_values", cfg.heat_t_values)
    try:
        heat_vals = tuple(float(t) for t in heat)
        heat_vals = tuple(t for t in heat_vals if t > 0.0)
        merged["heat_t_values"] = heat_vals if len(heat_vals) else cfg.heat_t_values
    except Exception:
        merged["heat_t_values"] = cfg.heat_t_values

    merged["gap_scale"] = _pos_num(merged["gap_scale"], cfg.gap_scale)
    merged["contra_scale"] = _pos_num(merged["contra_scale"], cfg.contra_scale)
    merged["support_scale"] = _pos_num(merged["support_scale"], cfg.support_scale)

    merged["w_gap"] = _pos_num(merged["w_gap"], cfg.w_gap)
    merged["w_support_energy"] = _pos_num(merged["w_support_energy"], cfg.w_support_energy)
    merged["w_anti_contra"] = _pos_num(merged["w_anti_contra"], cfg.w_anti_contra)
    merged["w_circularity_penalty"] = _pos_num(merged["w_circularity_penalty"], cfg.w_circularity_penalty)

    merged["alpha"] = _pos_num(merged["alpha"], cfg.alpha)
    merged["beta"] = _pos_num(merged["beta"], cfg.beta)
    merged["clip"] = _pos_num(merged["clip"], cfg.clip)
    merged["tau"] = _pos_num(merged["tau"], cfg.tau)

    merged["eps"] = _pos_num(merged["eps"], cfg.eps) or cfg.eps

    # Claim importance weights
    merged["importance_w_centrality"] = _pos_num(merged.get("importance_w_centrality", cfg.importance_w_centrality), cfg.importance_w_centrality)
    merged["importance_w_influence"] = _pos_num(merged.get("importance_w_influence", cfg.importance_w_influence), cfg.importance_w_influence)
    merged["importance_w_grounding"] = _pos_num(merged.get("importance_w_grounding", cfg.importance_w_grounding), cfg.importance_w_grounding)
    merged["importance_w_problem"] = _pos_num(merged.get("importance_w_problem", cfg.importance_w_problem), cfg.importance_w_problem)
    merged["priority_critical_threshold"] = _pos_num(merged.get("priority_critical_threshold", cfg.priority_critical_threshold), cfg.priority_critical_threshold)
    merged["priority_high_threshold"] = _pos_num(merged.get("priority_high_threshold", cfg.priority_high_threshold), cfg.priority_high_threshold)
    merged["centrality_iterations"] = max(1, _pos_int(merged.get("centrality_iterations", cfg.centrality_iterations), cfg.centrality_iterations))

    return SpectralConfig(**merged)

