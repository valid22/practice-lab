# Practice Lab

A local Python workspace for technical interview practice. Browse problems by company, difficulty, topic, and completion status, then open a problem in its own coding workspace.

## Start with Docker

With Docker running, start Practice Lab from this folder.

```sh
docker compose up -d --build
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Stop it with `docker compose down`. The Docker volume keeps attempts, completion records, and hidden cases across restarts. If port 8000 is busy, run `PRACTICE_PORT=8001 docker compose up -d --build` and open [port 8001](http://127.0.0.1:8001).

### Optional local HTTPS on macOS

To use `https://practice.lab`, add `127.0.0.1 practice.lab` to `/etc/hosts` with `sudo nano /etc/hosts`. Create the local certificate once from this folder.

```sh
(
  umask 077
  mkdir -p .practice-tls
  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 365 \
    -subj /CN=practice.lab \
    -addext subjectAltName=DNS:practice.lab \
    -addext basicConstraints=critical,CA:FALSE \
    -addext keyUsage=critical,digitalSignature,keyEncipherment \
    -addext extendedKeyUsage=serverAuth \
    -keyout .practice-tls/practice.lab.key -out .practice-tls/practice.lab.crt
)
```

Trust the `practice.lab` server certificate for SSL. The certificate contains only the `practice.lab` hostname and cannot issue other certificates. macOS may prompt for administrator authentication.

```sh
security add-trusted-cert -r trustRoot -p ssl \
  -k "$HOME/Library/Keychains/login.keychain-db" .practice-tls/practice.lab.crt
```

Add `COMPOSE_PROFILES=https` to a local `.env` file in this folder. This keeps the HTTPS service enabled for both `docker compose up -d` and `docker compose down`. Start the app and open [https://practice.lab](https://practice.lab). The HTTPS address uses the same Docker database as the HTTP address. Browser drafts and custom tests belong to the address at which they were created.

### Run without Docker

Use Python 3.9 or newer on macOS or Linux.

```sh
python3 -B server.py
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Press Ctrl+C in Terminal to stop the server. Add `--port 8001` to use a different port.

## Practice

1. Find a problem in **Problems** and open it. Write the function shown in the editor, using imports and helper functions as needed. The runner calls it with each case's positional arguments and checks the return value.
2. Click **Run** to try public or custom cases. Press **⌘ Enter** on macOS or **Ctrl+Enter** to run from the editor.
3. Click **Submit** to check every public and private case. If any case returns a wrong answer, Results shows the verdict summaries and the first wrong-answer case with its arguments, expected return, your return, time, and peak memory. A passing submission marks the problem complete and unlocks the full suite in **Private**.
4. Open **Attempts** to review past results or restore saved code. Test runs and submissions save automatically. **Save attempt** keeps a code snapshot without running tests.

In **Custom**, enter positional arguments as a JSON array. For `compute(start_node_id, from_ids, to_ids)`, use a value like `[42, [], []]`. Turn on **Check expected return** to grade the returned value. Use JSON notation, including quotes for a string and `null` for Python's `None`. Printed text appears separately in the results. JSON object key order is ignored.

Open **Complexity** and choose **Analyze code** for a source-based time estimate from [bigopy](https://pypi.org/project/bigopy/). Docker includes it. For a native setup, install it in your Python environment with `python3 -m pip install -r requirements-complexity.txt`.

**Benchmark** is available for Simple Network, Count Four Shop Routes, and Microorganism Simulation. It checks generated inputs at six sizes and displays the median of five function timings and the peak Python allocation from a separate call at each size. The estimates describe the tested input family. Short size ranges or similar growth curves can produce an inconclusive result. Complexity analysis does not save an attempt.

The Python editor provides context-aware indentation, folding in the gutter, bracket matching and pairing, Python completions, and find and replace. Use **Tab** and **Shift+Tab** to indent or outdent, **⌘/** or **Ctrl+/** to toggle comments, **⌘ F** or **Ctrl+F** to find, and **Option/Alt+↑/↓** to move lines. Press **Esc**, then **Tab**, to move focus out of the editor.

Use **Appearance** to choose Light, Dark, Night, or Auto. Auto follows your device's light or dark setting. **Color scheme** changes the app accent and Python syntax colors. Your choices are saved in your browser.

Each case runs in a fresh Python process with a 2-second time limit and a 128 MiB memory limit. Docker and Linux enforce the memory limit on process address space. Native macOS checks peak resident memory during execution and at exit. After 20 seconds for the entire run, the judge reports any remaining cases as **Not run**. Results group the cases by source and show the selected case's elapsed time and peak resident memory, including Python startup. Older attempts show a dash when a measurement is unavailable. Long arguments and expected returns show a preview. Printed output and returned values are scrollable. **Copy** copies the full captured value. Submitted functions run with your account's permissions, so run code you trust.

## Add another problem

The catalog lives in `problems.json`. Add an object with a unique ID, title, Markdown statement, function name, starter code, topics, and public `samples`. Each sample has a name, an `args` array, and an `expected` JSON value. Configure hidden cases with a factory keyed by the problem ID in `case_factory.py`. To tag a problem, add the company IDs to its `companies` array. Add a `reports` entry with `company`, `round`, and `url` for each source. Use the optional `detail` field to describe how a reported variant differs. Define company names and optional logo filenames in `companies.json`, with logos stored in `web/company-logos/`. Restart the Python server or rerun `docker compose up -d --build` to load catalog changes.

## Local data

Native Python runs store attempts, completion records, and generated hidden cases in `.practice/practice.sqlite3`. Docker runs use the separate `practice-data` volume. The generated cases are retained across restarts and their concrete inputs stay in the local database. The source repository contains the case generators. Drafts and custom cases live in the browser, so keep using the same address and browser profile to see them.

When a problem's judge gets a new suite version, the app keeps the earlier attempts and generates the new cases once. Pass a new submission to mark the current suite complete and unlock its cases.

Earlier script drafts and saved attempts remain available for the seeded problems. Update an older draft to use the function signature before running it, or choose **Reset code** to start from the new template.

## Sources

Simple Network, Count Four Shop Routes, and Microorganism Simulation are independent practice reconstructions based on [a public candidate report](https://www.reddit.com/r/InterviewDB/comments/1x011r4/openai_new_grad_coderpad_oa_questions/). The OpenAI tag uses the [OpenAI Blossom symbol archived by Wikimedia Commons](https://commons.wikimedia.org/wiki/File:OpenAI_logo_2025_(symbol).svg), which belongs to OpenAI. Company tags identify the reported interview source.

The [CodeMirror](https://codemirror.net/) editor is bundled locally and runs offline. To rebuild it after changing `web/editor.js` or its dependencies, run `npm ci` and `npm run build:editor`.
