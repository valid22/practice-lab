# Practice Lab

A local, function-based Python workspace for OpenAI Emerging Talent preparation. Simple Network, Count Four Shop Routes, and Microorganism Simulation are independent practice reconstructions based on [a public candidate report](https://www.reddit.com/r/InterviewDB/comments/1x011r4/openai_new_grad_coderpad_oa_questions/). Their wording, examples, and Python signatures are written for this workspace.

## Start the app

Use Python 3.9 or newer on macOS or Linux. The app uses Python's standard library and works offline.

```sh
python3 -B server.py
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Keep Terminal open while you practice. Press Ctrl+C in Terminal to stop the server. If the port is in use, add `--port 8001` and open the printed address.

## Practice

1. Choose a problem. Write the function shown in the editor, using imports and helper functions as needed. The runner calls it with each case's positional arguments and checks the return value.
2. Click **Run** to try public or custom cases. Press **⌘ Enter** on macOS or **Ctrl+Enter** to run from the editor.
3. Click **Submit** to check every public and hidden case. A passing submission marks the problem complete and unlocks the inputs and expected returns in **Hidden**. Until then, submission results show the hidden pass count.
4. Open **Attempts** to review past results or restore saved code. Test runs and submissions save automatically. **Save attempt** keeps a code snapshot without running tests.

In **Custom**, enter positional arguments as a JSON array. For `compute(start_node_id, from_ids, to_ids)`, use a value like `[42, [], []]`. Turn on **Check expected return** to grade the returned value. Use JSON notation, including quotes for a string and `null` for Python's `None`. Printed text appears separately in the results. JSON object key order is ignored.

The editor inserts four spaces on **Tab** and carries indentation on **Enter**. Press **Esc**, then **Tab**, to move focus out of the editor. The runner gives each case a fresh Python process with up to 2 seconds per case and 8 seconds per run. Submitted functions run with your account's permissions, so run code you trust.

## Add another problem

The catalog lives in `problems.json`. Add an object with a unique ID, title, Markdown statement, function name, starter code, topics, and public `samples`. Each sample has a name, an `args` array, and an `expected` JSON value. Configure hidden cases with a factory keyed by the problem ID in `case_factory.py`. Restart the server to load catalog additions.

## Local data

Attempts, completion records, and generated hidden cases live in `.practice/practice.sqlite3`. The generated cases are retained across restarts and their concrete inputs stay in the local database. The source repository contains the case generators. Drafts and custom cases live in the browser, so keep using the same address and browser profile to see them.

Earlier script drafts and saved attempts remain available for the seeded problems. Update an older draft to use the function signature before running it, or choose **Reset code** to start from the new template.
