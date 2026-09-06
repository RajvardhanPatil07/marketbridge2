from marketbridge.estimator import Observation, ScalarKalman, conformal_half_width, fit_ridge, robust_fuse


def test_ridge_recovers_linear_factor():
    model = fit_ridge([([0.0], 1.0), ([1.0], 3.0), ([2.0], 5.0), ([3.0], 7.0)], l2=0.0)
    assert abs(model.predict([4.0]) - 9.0) < 1e-9


def test_kalman_moves_toward_observation():
    k = ScalarKalman(100.0)
    before = k.price
    k.predict()
    k.update(110.0, 1e-4)
    assert before < k.price < 110.0


def test_family_cap_prevents_reseller_dominance():
    result = robust_fuse([
        Observation("a1", "family-a", 100),
        Observation("a2", "family-a", 100),
        Observation("a3", "family-a", 100),
        Observation("b1", "family-b", 110),
    ])
    assert result.family_count == 2
    assert result.weights["b1"] >= 0.4
    assert result.price < 110


def test_conformal_quantile():
    assert conformal_half_width([10, 20, 30, 40], 0.75) == 0.004
