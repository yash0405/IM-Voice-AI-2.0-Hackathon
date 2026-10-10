"""Independent referees for the engine's statistics: statsmodels (BSD-3) and GrowthBook's open-source stats engine gbstats (MIT).

The engine runs on numpy and scipy only. These tests recompute the same quantities with the two libraries on a fixed grid of cases and
require them to agree. They are skipped when the libraries are not installed (they are not runtime dependencies):
    pip install statsmodels pandas && pip install --no-deps gbstats
"""
import itertools
import math
import unittest

from picky import seqdesign, stats

try:
    from statsmodels.stats.power import NormalIndPower  # noqa: F401
    from statsmodels.stats.proportion import confint_proportions_2indep, power_proportions_2indep, proportion_confint, proportions_ztest
    HAVE_SM = True
except ImportError:
    HAVE_SM = False
try:
    from gbstats.utils import check_srm
    HAVE_GB = True
except ImportError:
    HAVE_GB = False

# leads per arm and conversions: small and large tests, rates from 5% to 70%, B above, equal to and below A
CASES = [(n_a, x_a, n_b, x_b) for n_a, n_b in [(60, 40), (700, 300), (3500, 1500), (20000, 20000)]
         for ra, rb in [(0.45, 0.45), (0.45, 0.51), (0.45, 0.39), (0.05, 0.08), (0.70, 0.66)]
         for x_a, x_b in [(round(n_a * ra), round(n_b * rb))]]


@unittest.skipUnless(HAVE_SM, "statsmodels not installed")
class AgainstStatsmodels(unittest.TestCase):
    def test_the_decision_statistic_is_the_textbook_pooled_z(self):
        for n_a, x_a, n_b, x_b in CASES:
            z_ref, _ = proportions_ztest([x_b, x_a], [n_b, n_a], value=0, alternative="two-sided", prop_var=False)
            self.assertAlmostEqual(stats.pooled_z(x_a, n_a, x_b, n_b), z_ref, places=9, msg=(n_a, x_a, n_b, x_b))

    def test_the_range_shown_agrees_with_the_score_interval(self):
        """The dashboard's range for B minus A inverts the engine's own score test. statsmodels' score interval (Miettinen-Nurminen) uses a
        slightly different variance away from 0, so the ends differ a little on tiny tests and vanish as tests grow; the call (does the range
        exclude 0?) is the same in every case, because at 0 both are the pooled z test."""
        tol = {100: 0.01, 1000: 0.001, 5000: 0.0002, 40000: 0.0001}                  # measured: 0.93, 0.08, 0.014, 0.002 points
        for (n_a, x_a, n_b, x_b), conf in itertools.product(CASES, (0.95, 0.99)):
            crit = stats.norm_ppf(1 - (1 - conf) / 2)
            _, lo, hi = stats.score_diff_ci(x_a, n_a, x_b, n_b, crit)
            lo_ref, hi_ref = confint_proportions_2indep(x_b, n_b, x_a, n_a, method="score", compare="diff", alpha=1 - conf, correction=False)
            self.assertLess(max(abs(lo - lo_ref), abs(hi - hi_ref)), tol[n_a + n_b], msg=(n_a, x_a, n_b, x_b, conf))
            self.assertEqual((lo > 0, hi < 0), (lo_ref > 0, hi_ref < 0), msg=("the call differs", n_a, x_a, n_b, x_b, conf))

    def test_each_prompts_rate_range_is_wilson(self):
        for n_a, x_a, n_b, x_b in CASES:
            for x, n in ((x_a, n_a), (x_b, n_b)):
                lo, hi = stats.wilson(x, n, 1.959963984540054)
                lo_ref, hi_ref = proportion_confint(x, n, alpha=0.05, method="wilson")
                self.assertAlmostEqual(lo, lo_ref, places=9)
                self.assertAlmostEqual(hi, hi_ref, places=9)

    def test_the_planned_test_size_gives_the_planned_power(self):
        """Over VANI's range (BuyLead rate 35 to 60%, a 3 to 5 point lift, 30 to 50% of leads on B) a one-look test of the planned size has
        79.4 to 80.5% power by statsmodels: the planned 80%. Known gap, measured here and confirmed by 200,000 simulated tests: far from
        that range the planner's unpooled formula drifts (10% on B and a 10-point lift: 77% at a 60% baseline, 85% at 20%).
        Fix if those plans matter: pooled variance in the alpha term, as statsmodels does."""
        for p_a, mde, share in itertools.product((0.35, 0.45, 0.475, 0.55, 0.60), (0.03, 0.045, 0.05), (0.3, 0.5)):
            n = seqdesign.plan_sample_size(p_a, mde, share, alpha=0.025, power=0.8)["n_fixed"]
            n_b, n_a = n * share, n * (1 - share)
            pw = power_proportions_2indep(diff=mde, prop2=p_a, nobs1=n_b, ratio=n_a / n_b, alpha=0.025, alternative="larger", return_results=False)
            self.assertAlmostEqual(pw, 0.80, delta=0.008, msg=(p_a, mde, share, n, pw))


@unittest.skipUnless(HAVE_GB, "gbstats not installed")
class AgainstGrowthBook(unittest.TestCase):
    def test_split_check_agrees_with_growthbooks_srm_check(self):
        """GrowthBook's check_srm is a chi-square goodness-of-fit test; for two arms it equals our two-sided z test of B's share."""
        for n_a, n_b, share in [(700, 300, 0.30), (690, 310, 0.30), (640, 360, 0.30), (5000, 5000, 0.5), (5100, 4900, 0.5), (9500, 500, 0.05), (9400, 600, 0.05)]:
            ours = stats.srm_pvalue(n_a, n_b, share)
            ref = float(check_srm([n_a, n_b], [1 - share, share]))
            self.assertAlmostEqual(ours, ref, places=9, msg=(n_a, n_b, share))
        self.assertLess(stats.srm_pvalue(640, 360, 0.30), 0.001)                 # both flag a broken 36% split of a 30% plan at 1,000 leads


if __name__ == "__main__":
    unittest.main()
