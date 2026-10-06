import functools
import http.server
import json
import sys
import threading
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

export_dir = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/second-web-audit').resolve()
audit_dir = Path('/tmp/second-web-landing-smoke')
capture_dir = Path(__file__).resolve().parent / 'captures'
audit_dir.mkdir(exist_ok=True)
capture_dir.mkdir(exist_ok=True)


class LandingHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Match Firebase Hosting's existing ** -> /index.html rewrite.
        request_path = urlsplit(self.path).path.lstrip('/')
        if not (export_dir / request_path).is_file():
            self.path = '/index.html'
        return super().do_GET()

    def log_message(self, *_args):
        pass


server = http.server.ThreadingHTTPServer(
    ('127.0.0.1', 9041), functools.partial(LandingHandler, directory=str(export_dir))
)
threading.Thread(target=server.serve_forever, daemon=True).start()
results = []
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox']
        )
        cases = [
            ('desktop-root', '/', {'width': 1280, 'height': 900}, 'seconde://'),
            ('desktop-article', '/article/local-audit?source=local', {'width': 1280, 'height': 900}, 'seconde://article/local-audit?source=local'),
            ('mobile-root', '/', {'width': 390, 'height': 844}, 'seconde://'),
        ]
        for name, path, viewport, expected_href in cases:
            context = browser.new_context(viewport=viewport)
            attempted_remote_urls = []
            local_urls = []

            def local_only(route):
                url = urlsplit(route.request.url)
                if url.scheme in ('data', 'blob'):
                    route.continue_()
                elif url.hostname == '127.0.0.1' and url.port == 9041:
                    local_urls.append(route.request.url)
                    route.continue_()
                else:
                    attempted_remote_urls.append(url.hostname)
                    route.abort()

            context.route('**/*', local_only)
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(error.stack))
            page.goto(f'http://127.0.0.1:9041{path}', wait_until='networkidle', timeout=30000)
            page.wait_for_timeout(300)
            assert page.locator('h1').inner_text() == 'Seconde'
            assert page.locator('#open-app').is_visible()
            href = page.locator('#open-app').get_attribute('href')
            assert href == expected_href, (name, href)
            assert page.locator('#root').count() == 0
            assert errors == [], (name, errors)
            assert attempted_remote_urls == [], (name, attempted_remote_urls)
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.screenshot(path=str(capture_dir / f'web-landing-{name}.png'), full_page=True)
            (audit_dir / f'{name}.txt').write_text(page.locator('body').inner_text())
            results.append({
                'case': name,
                'title': page.title(),
                'openAppHref': href,
                'rootElementCount': 0,
                'pageErrors': errors,
                'remoteRequestsAttempted': attempted_remote_urls,
                'localRequestPaths': [urlsplit(url).path for url in local_urls],
                'viewport': viewport,
                'screenshot': str(capture_dir / f'web-landing-{name}.png'),
            })
            context.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()

result = {'passed': len(results), 'cases': results}
(audit_dir / 'result.json').write_text(json.dumps(result, indent=2, ensure_ascii=False))
print(json.dumps(result, indent=2, ensure_ascii=False))
