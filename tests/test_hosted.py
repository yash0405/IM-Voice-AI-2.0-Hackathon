"""Hosted mode: password, allowlist, and that the data endpoints stay off."""
import base64
import http.client
import threading
import unittest
from http.server import ThreadingHTTPServer

from canary import server


class HostedMode(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.HOSTED.update(on=True, password="team-secret-1")
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.H)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.auth = {"Authorization": "Basic " + base64.b64encode(b"team:team-secret-1").decode()}

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        server.HOSTED.update(on=False, password=None)

    def req(self, method, path, headers=None, body=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        c.request(method, path, body=body, headers=headers or {})
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, data

    def test_password_required(self):
        self.assertEqual(self.req("GET", "/")[0], 401)
        self.assertEqual(self.req("GET", "/api/console")[0], 401)
        wrong = {"Authorization": "Basic " + base64.b64encode(b"team:nope").decode()}
        self.assertEqual(self.req("GET", "/", wrong)[0], 401)

    def test_health_is_open_and_names_the_build(self):
        status, data = self.req("GET", "/healthz")
        self.assertEqual(status, 200)
        self.assertIn(b'"ok":true', data)

    def test_engine_screens_work_with_the_password(self):
        status, data = self.req("GET", "/", self.auth)
        self.assertEqual(status, 200)
        self.assertIn(b"CANARY_HOSTED=true", data)
        self.assertEqual(self.req("GET", "/api/samples", self.auth)[0], 200)
        self.assertEqual(self.req("GET", "/api/sample/b_wins", self.auth)[0], 200)

    def test_data_endpoints_are_off(self):
        for path in ("/tools.html", "/api/bundle", "/api/labels/summary", "/api/labels/next?labeler=x", "/api/evalbench",
                     "/api/transcript/1", "/audio/1", "/arena/busy_A.mp3", "/app.js", "/data/base_prompt.md", "/.env"):
            self.assertEqual(self.req("GET", path, self.auth)[0], 404, path)
        for path in ("/api/run", "/api/labels"):
            self.assertEqual(self.req("POST", path, {**self.auth, "Content-Type": "application/json"}, b"{}")[0], 404, path)

    def test_wizard_runs_and_oversize_bodies_are_refused(self):
        hdr = {**self.auth, "Content-Type": "application/json"}
        import json
        from canary import variants
        body = {"name": "t", "window_days": 7, "leads_per_day": 500, "effect_rel": 0.1, "prompt_b": variants.load_base()["text"],
                "metrics": [{"role": "primary", "key": "buylead_created"}]}
        status, _ = self.req("POST", "/api/wizard", hdr, json.dumps(body).encode())
        self.assertEqual(status, 200)
        big = b'{"name":"' + b"x" * 4_100_000 + b'"}'
        try:
            self.assertEqual(self.req("POST", "/api/wizard", hdr, big)[0], 413)
        except (BrokenPipeError, ConnectionResetError):          # the server refuses before reading the body and closes the socket
            pass


if __name__ == "__main__":
    unittest.main()
