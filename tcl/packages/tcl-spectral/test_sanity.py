#!/usr/bin/env python3
"""
Sanity test for TCL-Spectral platform upgrade.
Verifies that existing functionality is preserved and new features work.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from spectral import spectral_metrics, spectral_truth_vector, spectral_edge_attribution, spectral_fingerprint

def test_existing_functionality():
    """Test that existing spectral_metrics() works unchanged."""
    print("Testing existing spectral_metrics()...")
    
    n = 5
    supports = [(0, 1, 0.8), (1, 2, 0.7), (2, 3, 0.6)]
    contradictions = [(0, 3, 0.9), (1, 4, 0.5)]
    grounded = {0, 2}
    
    result = spectral_metrics(
        n=n,
        support_edges=supports,
        contradiction_edges=contradictions,
        grounded_ids=grounded
    )
    
    # Verify all expected fields exist
    assert "coherenceScore" in result
    assert "contradictionEnergy" in result
    assert "supportEnergy" in result
    assert "circularityScore" in result
    assert "spectralGap" in result
    assert "cycleMass" in result
    assert "heatTrace" in result
    
    # Verify types
    assert isinstance(result["coherenceScore"], int)
    assert isinstance(result["contradictionEnergy"], float)
    assert isinstance(result["supportEnergy"], float)
    assert isinstance(result["circularityScore"], int)
    assert isinstance(result["spectralGap"], float)
    assert isinstance(result["cycleMass"], float)
    assert isinstance(result["heatTrace"], list)
    
    print("✅ Existing functionality preserved")
    return result

def test_new_truth_vector():
    """Test new spectral_truth_vector() function."""
    print("\nTesting new spectral_truth_vector()...")
    
    n = 5
    supports = [(0, 1, 0.8), (1, 2, 0.7), (2, 3, 0.6)]
    contradictions = [(0, 3, 0.9), (1, 4, 0.5)]
    grounded = {0, 2}
    
    result = spectral_truth_vector(
        n=n,
        support_edges=supports,
        contradiction_edges=contradictions,
        grounded_ids=grounded
    )
    
    # Verify structure
    assert "truthVector" in result
    assert "truthStates" in result
    assert len(result["truthVector"]) == n
    assert len(result["truthStates"]) == n
    
    # Verify types and values
    for val in result["truthVector"]:
        assert isinstance(val, float)
        assert -1.0 <= val <= 1.0  # Should be clamped
    
    for state in result["truthStates"]:
        assert state in ["Supported", "Contradicted", "Ungrounded", "Inconclusive"]
    
    print("✅ Truth vector computation works")
    return result

def test_new_edge_attribution():
    """Test new spectral_edge_attribution() function."""
    print("\nTesting new spectral_edge_attribution()...")
    
    truth_vector = [0.8, 0.6, -0.3, -0.5, 0.2]
    supports = [(0, 1, 0.8), (1, 2, 0.7), (2, 3, 0.6)]
    contradictions = [(0, 3, 0.9), (1, 4, 0.5)]
    
    result = spectral_edge_attribution(
        truth_vector=truth_vector,
        support_edges=supports,
        contradiction_edges=contradictions,
        top_k=10
    )
    
    # Verify structure
    assert "topBadContradictions" in result
    assert "topBadSupports" in result
    assert "nodeBlame" in result
    
    # Verify types
    assert isinstance(result["topBadContradictions"], list)
    assert isinstance(result["topBadSupports"], list)
    assert isinstance(result["nodeBlame"], list)
    assert len(result["nodeBlame"]) == len(truth_vector)
    
    # Verify edge attribution structure
    for edge in result["topBadContradictions"]:
        assert "claimAIndex" in edge
        assert "claimBIndex" in edge
        assert "weight" in edge
        assert "badness" in edge
    
    print("✅ Edge attribution works")
    return result

def test_new_fingerprint():
    """Test new spectral_fingerprint() function."""
    print("\nTesting new spectral_fingerprint()...")
    
    result = spectral_fingerprint(
        coherence_score=75,
        spectral_gap=0.5,
        contradiction_energy=0.3,
        circularity_score=20,
        heat_trace=[1.0, 0.8, 0.6]
    )
    
    # Verify structure
    assert "coherenceScore" in result
    assert "spectralGap" in result
    assert "contradictionEnergy" in result
    assert "circularityScore" in result
    assert "heatTrace" in result
    
    print("✅ Fingerprint generation works")
    return result

if __name__ == "__main__":
    print("=" * 60)
    print("TCL-Spectral Platform Upgrade Sanity Test")
    print("=" * 60)
    
    try:
        # Test existing functionality (must not break)
        test_existing_functionality()
        
        # Test new functionality
        test_new_truth_vector()
        test_new_edge_attribution()
        test_new_fingerprint()
        
        print("\n" + "=" * 60)
        print("✅ ALL TESTS PASSED - No breaking changes detected")
        print("=" * 60)
        sys.exit(0)
        
    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

