"""HL Bucket (Top 3 / Rest) is fixed by the PM's "Data type passed" table. This pins that table so no change can drift from it silently."""
import unittest

from canary import catalog

# copied by hand from the PM's table (Oct 10, 2026), plus the PM's answer for the five types it did not list: TF and UATF are Top 3, the rest Rest
PM_TABLE = {"NUR": "Rest", "PIM": "Rest", "UA": "Rest", "PUA": "Rest", "ENQR": "Rest", "PNSM": "Rest", "PNSR": "Rest",
            "SCHD": "Top 3", "OLP": "Top 3", "OLPR": "Top 3", "PAM": "Top 3", "PNCHF": "Top 3", "PANF": "Top 3", "PUT": "Top 3", "NVGT": "Top 3",
            "TF": "Top 3", "UATF": "Top 3"}


class HLBucket(unittest.TestCase):
    def test_every_type_in_the_pm_table_has_the_pm_bucket(self):
        for t, b in PM_TABLE.items():
            self.assertEqual(catalog.derive("hl_bucket", t), b, t)
            self.assertEqual(catalog.VARS["hl_bucket"]["derive"][t], b, t)

    def test_top3_is_exactly_the_ten_types_of_the_table(self):
        self.assertEqual(sorted(catalog.HL_TOP3), sorted(t for t, b in PM_TABLE.items() if b == "Top 3"))
        for t in ("UA", "PIM", "PUA", "NUR"):                           # the three most common types in the real data are Rest, not Top 3
            self.assertNotIn(t, catalog.HL_TOP3)

    def test_every_hl_type_is_in_the_table(self):
        self.assertEqual(set(catalog.VARS["hl_type"]["values"]), set(PM_TABLE))  # no type is left to a default
        for t in ("ENQR", "PNSM", "PNSR"):                              # not the dashboard's ELSE 'Top 3': the PM put these in Rest
            self.assertEqual(catalog.derive("hl_bucket", t), "Rest", t)

    def test_the_text_the_dashboard_shows_states_the_rule(self):
        meaning = catalog.VARS["hl_bucket"]["meaning"]
        self.assertEqual(meaning, "Top 3: SCHD, OLP, OLPR, PAM, PNCHF, PANF, PUT, NVGT, TF, UATF. Rest: NUR, PIM, UA, PUA, ENQR, PNSM, PNSR")
        self.assertNotIn("UA, PNSM, PNSR", meaning)                     # the old, wrong definition

    def test_a_lead_never_disagrees_with_the_table(self):
        for i in range(3000):
            a = catalog.lead_vars(f"L{i:07d}")
            self.assertEqual(a["hl_bucket"], PM_TABLE.get(a["hl_type"], "Rest"))

    def test_the_segment_builder_follows_the_table(self):
        catalog.validate_segment([{"column": "hl_bucket", "values": ["Top 3"]}, {"column": "hl_type", "values": ["OLP"]}])
        with self.assertRaises(ValueError):
            catalog.validate_segment([{"column": "hl_bucket", "values": ["Top 3"]}, {"column": "hl_type", "values": ["UA"]}])   # UA is Rest


if __name__ == "__main__":
    unittest.main()
