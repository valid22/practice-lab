# Practice Lab

A local Python workspace for technical interview practice. Browse problems by company, difficulty, topic, and completion status, then open a problem in its own coding workspace.

## Start with Docker

With Docker running, start Practice Lab from this folder.

```sh
docker compose up -d --build
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Stop it with `docker compose down`. The Docker volume keeps attempts, completion records, and hidden cases across restarts. If port 8000 is busy, run `PRACTICE_PORT=8001 docker compose up -d --build` and open [port 8001](http://127.0.0.1:8001).

### Run without Docker

Use Python 3.9 or newer on macOS or Linux.

```sh
python3 -B server.py
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Press Ctrl+C in Terminal to stop the server. Add `--port 8001` to use a different port.

## Practice

1. Find a problem in **Problems** and open it. Write the function shown in the editor, using imports and helper functions as needed. The runner calls it with each case's positional arguments and checks the return value.
2. Click **Run** to try public or custom cases. Press **⌘ Enter** on macOS or **Ctrl+Enter** to run from the editor.
3. Click **Submit** to check every public and hidden case. A passing submission marks the problem complete and unlocks the inputs and expected returns in **Hidden**. Until then, submission results show the hidden pass count.
4. Open **Attempts** to review past results or restore saved code. Test runs and submissions save automatically. **Save attempt** keeps a code snapshot without running tests.

In **Custom**, enter positional arguments as a JSON array. For `compute(start_node_id, from_ids, to_ids)`, use a value like `[42, [], []]`. Turn on **Check expected return** to grade the returned value. Use JSON notation, including quotes for a string and `null` for Python's `None`. Printed text appears separately in the results. JSON object key order is ignored.

The editor inserts four spaces on **Tab** and carries indentation on **Enter**. Press **Esc**, then **Tab**, to move focus out of the editor. The runner gives each case a fresh Python process with up to 2 seconds per case and 8 seconds per run. Submitted functions run with your account's permissions, so run code you trust.

## Add another problem

The catalog lives in `problems.json`. Add an object with a unique ID, title, Markdown statement, function name, starter code, topics, and public `samples`. Each sample has a name, an `args` array, and an `expected` JSON value. Configure hidden cases with a factory keyed by the problem ID in `case_factory.py`. To tag a problem, add the company IDs to its `companies` array. Add a `reports` entry with `company`, `round`, and `url` for each source. Use the optional `detail` field to describe how a reported variant differs. Define company names and optional logo filenames in `companies.json`, with logos stored in `web/company-logos/`. Restart the Python server or rerun `docker compose up -d --build` to load catalog changes.

## Local data

Native Python runs store attempts, completion records, and generated hidden cases in `.practice/practice.sqlite3`. Docker runs use the separate `practice-data` volume. The generated cases are retained across restarts and their concrete inputs stay in the local database. The source repository contains the case generators. Drafts and custom cases live in the browser, so keep using the same address and browser profile to see them.

Earlier script drafts and saved attempts remain available for the seeded problems. Update an older draft to use the function signature before running it, or choose **Reset code** to start from the new template.

## Sources

Simple Network, Count Four Shop Routes, and Microorganism Simulation are independent practice reconstructions based on [a public candidate report](https://www.reddit.com/r/InterviewDB/comments/1x011r4/openai_new_grad_coderpad_oa_questions/). The OpenAI tag uses the [OpenAI Blossom symbol archived by Wikimedia Commons](https://commons.wikimedia.org/wiki/File:OpenAI_logo_2025_(symbol).svg), which belongs to OpenAI. Company tags identify the reported interview source.
