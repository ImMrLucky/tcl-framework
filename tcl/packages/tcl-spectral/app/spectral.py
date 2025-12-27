import numpy as np
from typing import List, Dict, Tuple, Set

def build_index(claim_ids: List[str]) -> Dict[str, int]:
    return {cid: i for i, cid in enumerate(claim_ids)}

def _adjacency_directed(n: int,
                        support_edges: List[Tuple[int,int,float]],
                        contradiction_edges: List[Tuple[int,int,float]],
                        w_support: float,
                        w_contra: float) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Directed support adjacency (A_sup_dir), directed contradiction (A_con_dir).
    We also build signed adjacency A_signed_dir = A_sup_dir - A_con_dir.
    """
    A_sup = np.zeros((n, n), dtype=np.float64)
    A_con = np.zeros((n, n), dtype=np.float64)

    for i, j, w in support_edges:
        if i == j:
            continue
        A_sup[i, j] += float(max(0.0, w)) * float(w_support)

    for i, j, w in contradiction_edges:
        if i == j:
            continue
        A_con[i, j] += float(max(0.0, w)) * float(w_contra)

    A_signed = A_sup - A_con
    return A_signed, A_sup, A_con

def _symmetrize(A: np.ndarray) -> np.ndarray:
    return 0.5 * (A + A.T)

def _signed_laplacian_from_directed(A_signed_dir: np.ndarray) -> np.ndarray:
    """
    For spectral analysis we need a symmetric operator for stable real eigenvalues.
    We use the symmetrized signed adjacency: A = (A_dir + A_dir^T)/2
    Degree uses abs weights.
    """
    A = _symmetrize(A_signed_dir)
    D = np.diag(np.sum(np.abs(A), axis=1))
    return D - A

def _eigvals_sym(H: np.ndarray) -> np.ndarray:
    return np.linalg.eigvalsh(H)

def _heat_trace(evals: np.ndarray, t_values=(0.1, 1.0, 5.0)) -> List[float]:
    evals = np.clip(evals, 0.0, None)
    return [float(np.sum(np.exp(-t * evals))) for t in t_values]

def _cycle_mass_directed(A_sup_dir: np.ndarray, ungrounded: Set[int], max_len: int) -> float:
    """
    Grounding-aware directed cycle mass.
    We compute weighted directed cycle mass on the subgraph of UNGROUNDED claims.

    For a directed adjacency W (normalized to <= 1):
      trace(W^k) counts total weight of length-k directed cycles.
    We sum k=2..max_len, normalize by number of nodes to be scale-stable.

    Returns >= 0 (higher = more circular self-support).
    """
    nodes = sorted(list(ungrounded))
    m = len(nodes)
    if m <= 1:
        return 0.0

    # submatrix
    W = A_sup_dir[np.ix_(nodes, nodes)].copy()

    # normalize to [0,1] scale to prevent blowups
    maxw = float(np.max(W)) if float(np.max(W)) > 0.0 else 1.0
    W = W / maxw
    W = np.clip(W, 0.0, 1.0)

    cyc = 0.0
    P = W.copy()
    for k in range(2, max_len + 1):
        # For k=2, P is W^2 if we multiply once more
        if k == 2:
            P = W @ W
        else:
            P = P @ W
        cyc += float(np.trace(P)) / float(k)

    # normalize by node count (scale stability)
    return float(max(0.0, cyc / max(1.0, float(m))))

def spectral_metrics(n: int,
                     support_edges: List[Tuple[int,int,float]],
                     contradiction_edges: List[Tuple[int,int,float]],
                     grounded_ids: Set[int],
                     w_support: float = 1.0,
                     w_contradiction: float = 1.0,
                     w_circularity: float = 1.0,
                     cycle_max_len: int = 4) -> Dict[str, object]:
    if n <= 1:
        return {
            "spectralGap": 1.0,
            "contradictionEnergy": 0.0,
            "supportEnergy": 0.0,
            "circularityScore": 0,
            "cycleMass": 0.0,
            "heatTrace": [1.0, 1.0, 1.0],
            "coherenceScore": 100
        }

    A_signed, A_sup_dir, A_con_dir = _adjacency_directed(n, support_edges, contradiction_edges, w_support, w_contradiction)
    H = _signed_laplacian_from_directed(A_signed)

    evals = np.sort(np.clip(_eigvals_sym(H), 0.0, None))
    spectral_gap = float(evals[1] - evals[0]) if n >= 2 else 0.0

    support_energy = float(np.sum(A_sup_dir)) / max(1.0, float(n))
    contradiction_energy = float(np.sum(A_con_dir)) / max(1.0, float(n))

    # grounding-aware circularity: only penalize cycles among ungrounded claims
    ungrounded = set(range(n)) - set(grounded_ids)
    cycle_mass = _cycle_mass_directed(A_sup_dir, ungrounded, int(cycle_max_len))
    # map cycle_mass to 0..1
    cycle01 = 1.0 - np.exp(-1.2 * cycle_mass)
    circ_pen = float(np.clip(cycle01 * float(w_circularity), 0.0, 1.0))
    circularityScore = int(round(100.0 * float(np.clip(cycle01, 0.0, 1.0))))

    heat = _heat_trace(evals)

    # Soft-normalize
    gap_norm = 1.0 - np.exp(-3.0 * spectral_gap)                 # better
    contra_norm = 1.0 - np.exp(-1.2 * contradiction_energy)      # worse
    sup_norm = 1.0 - np.exp(-0.6 * support_energy)               # better (diminishing)

    coherence01 = (
        0.45 * gap_norm +
        0.30 * sup_norm +
        0.25 * (1.0 - contra_norm) -
        0.25 * circ_pen
    )
    coherence01 = float(np.clip(coherence01, 0.0, 1.0))
    coherenceScore = int(round(100.0 * coherence01))

    return {
        "spectralGap": spectral_gap,
        "contradictionEnergy": contradiction_energy,
        "supportEnergy": support_energy,
        "circularityScore": circularityScore,
        "cycleMass": float(cycle_mass),
        "heatTrace": heat,
        "coherenceScore": coherenceScore
    }
