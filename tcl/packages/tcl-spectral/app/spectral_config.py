# spectral_config.py

from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple


@dataclass(frozen=True)
class SpectralConfig:
    """
    All spectral constants are configurable. Defaults match current spectral.py behavior.
    Consumers can override these values from API request config or server config.
    """

    # -----------------------------
    # Adjacency weight multipliers
    # -----------------------------
    w_support: float = 1.0
    w_contradiction: float = 1.0
    w_circularity: float = 1.0

    # -----------------------------
    # Cycle mass / circularity
    # -----------------------------
    cycle_max_len: int = 4
    cycle_decay: float = 1.2  # cycle01 = 1 - exp(-cycle_decay * cycle_mass)

    # -----------------------------
    # Heat trace
    # -----------------------------
    heat_t_values: Tuple[float, ...] = (0.1, 1.0, 5.0)

    # -----------------------------
    # Coherence mapping (soft-normalize)
    # -----------------------------
    gap_scale: float = 3.0       # gap_norm = 1 - exp(-gap_scale * spectral_gap)
    contra_scale: float = 1.2    # contra_norm = 1 - exp(-contra_scale * contradiction_energy)
    support_scale: float = 0.6   # sup_norm = 1 - exp(-support_scale * support_energy)

    # -----------------------------
    # Coherence weights
    # -----------------------------
    w_gap: float = 0.45
    w_support_energy: float = 0.30
    w_anti_contra: float = 0.25
    w_circularity_penalty: float = 0.25  # coherence subtracts w_circularity_penalty * circ_pen

    # -----------------------------
    # Truth vector solver
    # -----------------------------
    alpha: float = 0.25
    beta: float = 1.0
    clip: float = 1.0
    tau: float = 0.15

    # Numerical tolerance (optional to tune)
    eps: float = 1e-10

    # -----------------------------
    # Claim importance weights (optional)
    # -----------------------------
    importance_w_centrality: float = 0.35
    importance_w_influence: float = 0.35
    importance_w_grounding: float = 0.20
    importance_w_problem: float = 0.10
    priority_critical_threshold: float = 0.75
    priority_high_threshold: float = 0.50
    centrality_iterations: int = 100

