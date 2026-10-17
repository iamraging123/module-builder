# Module Builder

Practice for the digital SAT and PSAT with questions from the College Board question bank.

**Open it:** https://iamraging123.github.io/module-builder/

## How it works

1. Export a set of questions as a PDF from the [College Board question bank](https://satsuiteeducatorquestionbank.collegeboard.org/). It is free and needs no account.
2. Open Module Builder and drop the PDF on the page, or press **Add questions**. Each question is cut out of the PDF along with its answer and explanation.
3. Filter by section, difficulty, skill or history, then start a module:
   - **Test**: timed, in the style of Bluebook, scored at the end.
   - **Study**: one question at a time, with the answer and explanation right after you check it.
4. **Your stats** shows your accuracy by section, domain, skill and difficulty, and suggests what to study next.

Math questions link to the Desmos calculator used on the test and include a formula reference.

## Your data

Nothing is uploaded. The PDFs are read in your browser, and your questions, modules and results are saved in your browser on your device. Clearing your browsing data deletes them, so use **Export everything** or **Export results only** on the start page now and then, and **Restore a backup** to bring them back or move to another computer.

This site does not include any test questions; you bring your own exports.

## Question sets in JSON

Besides PDFs, you can import your own question sets as a `.json` file with a `questions` list. Each question has `id`, `section`, `domain`, `skill`, `type` (`multiple_choice` or `student_produced`), `passage`, `prompt`, `choices` (`[{ "id": "A", "text": "..." }]`), `answer`, optional `accepted_answers`, and `explanation`. An optional `rules` list (`{ "id", "text" }`) is shown after each answer through a question's `rule_id`. A set becomes a study module as soon as it is imported.

## Running it on your own computer

With Python 3 installed, double-click `Start Module Builder.bat` (or run `python server.py`). Data is then saved in a `data` folder next to the app instead of in the browser.

Module Builder is an independent study tool and is not affiliated with or endorsed by College Board. SAT, PSAT/NMSQT and Bluebook are trademarks of College Board.
