"""Capture real RN screens through the isolated RN Web adapters, offline.

Requires local Vite servers (4173 baseline, 4174 current), system Chromium and
Python Playwright. Never contacts an external service; native gestures, alerts,
virtualization and physical safe areas are deliberately outside this evidence.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit
from urllib.parse import parse_qs
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--phase', choices=['before', 'after'], required=True)
args = parser.parse_args()
folder = Path(__file__).parent
captures = folder / 'captures'
captures.mkdir(exist_ok=True)
port = 4173 if args.phase == 'before' else 4174
base = [('home', 'screen=home'), ('catalogue', 'screen=catalogue'),
        ('proposal', 'screen=proposal'), ('mine', 'screen=mine'),
        ('detail-sent', 'screen=detail'), ('detail-received', 'screen=detail&role=receiver')]
cases = [(name, query, 390, 844, False, False) for name, query in base]
if args.phase == 'after':
    cases += [(f'{screen}-{state}', f'screen={screen}&state={state}', 390, 844, False, False)
              for screen, states in [('home', ['loading', 'error', 'empty']),
                                     ('catalogue', ['guest', 'loading', 'error', 'empty']),
                                     ('mine', ['guest', 'loading', 'error', 'empty']),
                                     ('proposal', ['guest']),
                                     ('detail', ['loading', 'missing'])]
              for state in states]
    cases += [('detail-accepted', 'screen=detail&status=accepted', 390, 844, True, False),
              ('detail-photos', 'screen=detail&status=photos_pending', 390, 844, True, False),
              ('detail-meetup', 'screen=detail&status=shipping&mode=hand_delivery', 390, 844, True, False),
              ('detail-postal', 'screen=detail&status=shipping&mode=shipping', 390, 844, True, False),
              ('detail-reception-confirmed', 'screen=detail&status=shipping&mode=hand_delivery&confirmed=yes', 390, 844, True, False),
              ('detail-completed', 'screen=detail&status=completed', 390, 844, True, False),
              ('detail-legacy', 'screen=detail&status=payment_pending&legacy=yes', 390, 844, True, False),
              ('detail-disputed', 'screen=detail&status=disputed', 390, 844, True, False),
              ('catalogue-narrow', 'screen=catalogue', 320, 740, False, False),
              ('proposal-narrow', 'screen=proposal', 320, 740, False, False),
              ('mine-narrow', 'screen=mine', 320, 740, False, False),
              ('detail-narrow', 'screen=detail', 320, 740, False, False),
              ('home-tablet', 'screen=home', 768, 1024, False, False),
              ('catalogue-tablet', 'screen=catalogue', 768, 1024, False, False),
              ('proposal-font130', 'screen=proposal', 320, 740, False, True)]
    cases += [('proposal-loading','screen=proposal&state=loading&open=mine',390,844,False,False),
              ('proposal-error','screen=proposal&state=error&open=mine',390,844,False,False),
              ('proposal-no-inventory','screen=proposal&state=no-inventory&open=mine',390,844,False,False),
              ('catalogue-deposit','screen=catalogue&open=deposit',390,844,False,False),
              ('catalogue-deposit-loading','screen=catalogue&state=inventory-loading&open=deposit',390,844,False,False),
              ('catalogue-deposit-error','screen=catalogue&state=inventory-error&open=deposit',390,844,False,False),
              ('catalogue-deposit-empty','screen=catalogue&state=no-inventory&open=deposit',390,844,False,False)]
    cases += [('detail-guest','screen=detail&state=guest',390,844,False,False),
              ('detail-expired','screen=detail&status=expired',390,844,True,False),
              ('detail-declined','screen=detail&status=declined',390,844,False,False),
              ('detail-cancelled','screen=detail&status=cancelled',390,844,False,False),
              ('home-narrow','screen=home',320,740,False,False),
              ('mine-font130','screen=mine',320,740,False,True),
              ('detail-font130','screen=detail&role=receiver',320,740,False,True)]
results = []
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    for name, query, width, height, bottom, enlarged in cases:
        context = browser.new_context(viewport={'width': width, 'height': height})
        remote = []
        errors = []
        def local_only(route):
            url = urlsplit(route.request.url)
            if url.scheme in ('data', 'blob') or (url.hostname == '127.0.0.1' and url.port == port):
                route.continue_()
            else:
                remote.append(url.hostname)
                route.abort()
        context.route('**/*', local_only)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(error.message))
        page.goto(f'http://127.0.0.1:{port}/?{query}', wait_until='networkidle')
        page.wait_for_function("document.querySelector('#root')?.innerText.trim().length > 5", timeout=15000)
        opened = parse_qs(query).get('open', [''])[0]
        if opened == 'mine':
            page.get_by_text('Ajouter des articles',exact=True).last.click()
        elif opened == 'deposit':
            page.get_by_text('Ajouter des articles',exact=True).first.click()
        page.wait_for_timeout(150)
        page.evaluate('document.fonts.ready')
        if enlarged:
            page.evaluate("""() => {for(const el of document.querySelectorAll('div,span,input,textarea')) {
                if([...el.childNodes].some(n=>n.nodeType===3 && n.textContent.trim())) {
                    const c=getComputedStyle(el);el.style.fontSize=(parseFloat(c.fontSize)*1.3)+'px';
                    if(c.lineHeight!=='normal')el.style.lineHeight=(parseFloat(c.lineHeight)*1.3)+'px';
                }
            }}""")
        if bottom:
            page.evaluate("""() => {for(const el of document.querySelectorAll('div')) {
              if(el.scrollHeight>el.clientHeight && ['auto','scroll'].includes(getComputedStyle(el).overflowY))el.scrollTop=el.scrollHeight;
            }}""")
        page.wait_for_timeout(100)
        body = page.locator('body').inner_text()
        assert not errors, (name, errors)
        assert 'Erreur de rendu' not in body, (name, body)
        assert not remote, (name, remote)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), name
        assert len(body.strip()) > 5, name
        screenshot = f'{args.phase}-{name}.png'
        page.screenshot(path=str(captures / screenshot))
        results.append({'case':name, 'viewport':{'width':width,'height':height},
                        'scroll':'bottom' if bottom else 'top', 'typographyScale':1.3 if enlarged else 1,
                        'pageErrors':errors, 'remoteRequestsAttempted':remote, 'bodyText':body,
                        'screenshot':f'captures/{screenshot}'})
        print(f'PASS {args.phase}/{name}')
        context.close()
    browser.close()
(folder / f'{args.phase}-visual-results.json').write_text(json.dumps({'passed':len(results),'cases':results},indent=2,ensure_ascii=False))
