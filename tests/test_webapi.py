"""The browser (Pyodide) entry point routes like the hosted server."""
import json
import unittest

from picky import variants, webapi


class WebApi(unittest.TestCase):
    def test_console_and_samples(self):
        s, t = webapi.handle("GET", "/api/console")
        self.assertEqual(s, 200)
        self.assertIn("defaults", json.loads(t))
        self.assertEqual(webapi.handle("GET", "/api/samples")[0], 200)
        self.assertEqual(webapi.handle("GET", "/api/sample/b_wins")[0], 200)

    def test_wizard_runs_and_bad_input_is_a_400(self):
        body = {"name": "t", "window_days": 7, "leads_per_day": 500, "effect_rel": 0.1, "prompt_b": variants.load_base()["text"],
                "metrics": [{"role": "primary", "key": "buylead_created"}]}
        s, t = webapi.handle("POST", "/api/wizard", json.dumps(body))
        self.assertEqual(s, 200, t[:200])
        self.assertEqual(webapi.handle("POST", "/api/wizard", json.dumps({"window_days": 5}))[0], 400)

    def test_data_routes_are_off(self):
        for m, p in (("GET", "/api/labels/summary"), ("GET", "/api/bundle"), ("GET", "/api/transcript/1"), ("POST", "/api/run"), ("POST", "/api/labels")):
            self.assertEqual(webapi.handle(m, p, "{}")[0], 404, p)


if __name__ == "__main__":
    unittest.main()
