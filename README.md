# Module Builder

Practice for the digital SAT and PSAT with questions from the College Board question bank.

**Open it:** https://iamraging123.github.io/module-builder/

## How it works

1. Export a set of questions as a PDF from the [College Board question bank](https://satsuiteeducatorquestionbank.collegeboard.org/). It is free and needs no account.
2. Open Module Builder and drop the PDF on the page, or press **Add questions**. Each question is cut out of the PDF along with its answer and explanation.
3. Study from five places:
   - **Today**: a short set planned for you each day, mixing questions you missed that are due again, your weakest skills, and new questions. You check each answer as you go.
   - **Practice**: build your own module by section, difficulty, skill or history, as a timed test in the style of Bluebook or as a study session.
   - **Mistakes**: every question you got wrong. A miss comes back the next day, then 3 days later, and clears after two right answers in a row. After a miss you can note why (didn't know the rule, fell for a trap, misread, rushed, careless).
   - **Skills**: every skill on the test, coloured by how often you get it right, with buttons to drill one.
   - **Question bank**: your files, plus backup and restore.

Math questions link to the Desmos calculator used on the test and include a formula reference.

## Your data

Nothing is uploaded. The PDFs are read in your browser, and your questions, modules and results are saved in your browser on your device. Clearing your browsing data deletes them, so use **Export everything** or **Export results only** under **Question bank** now and then, and **Restore a backup** to bring them back or move to another computer.

This site does not include any test questions; you bring your own exports.

## Question sets in JSON

Besides PDFs, you can import your own question sets as a `.json` file with a `questions` list. Each question has `id`, `section`, `domain`, `skill`, `type` (`multiple_choice` or `student_produced`), `passage`, `prompt`, `choices` (`[{ "id": "A", "text": "..." }]`), `answer`, optional `accepted_answers`, and `explanation`. An optional `rules` list (`{ "id", "text" }`) is shown after each answer through a question's `rule_id`. A set becomes a study module as soon as it is imported.

## Running it on your own computer

With Python 3 installed, double-click `Start Module Builder.bat` (or run `python server.py`). Data is then saved in a `data` folder next to the app instead of in the browser.

Module Builder is an independent study tool and is not affiliated with or endorsed by College Board. SAT, PSAT/NMSQT and Bluebook are trademarks of College Board.
