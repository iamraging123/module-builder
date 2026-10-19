# Module Builder

Practice for the digital SAT and PSAT with questions from the College Board question bank.

**Open it:** https://iamraging123.github.io/module-builder/

## How it works

1. In the [College Board question bank](https://satsuiteeducatorquestionbank.collegeboard.org/) (free, no account), select questions, press **Export**, choose **With correct answers and explanations**, and press **Download PDF**.
2. Open Module Builder and drop the PDF on the page, or press **Add questions**. Each question is cut out of the PDF along with its answer and explanation.
3. Study from five places:
   - **Get started**: step-by-step instructions, ticked off as you go, and how your progress is saved.
   - **Practice**: build your own module by section, difficulty, skill or history, as a timed test in the style of Bluebook or as a study session.
   - **Mistakes**: every question you got wrong. A miss comes back the next day, then 3 days later, and clears after two right answers in a row. After a miss you can note why (didn't know the rule, fell for a trap, misread, rushed, careless).
   - **Skills**: every skill on the test, colored by how often you get it right, with buttons to drill one.
   - **Question bank**: your files, plus backup and restore.

Math questions link to the Desmos calculator used on the test and include a formula reference.

## Your data

The PDFs are read in your browser, and your questions, modules and results save by themselves after every answer, in your browser on your device. Another browser or computer won't see them, and a private window doesn't keep them.

To use them on more than one computer, press **Sign in** at the top of the sidebar (top right on phones). Your progress then syncs to a hidden app folder in your own Google Drive, which only you and Module Builder can see, and signing in with the same account elsewhere brings it over. Each Google account gets its own space in the browser, so people sharing a computer don't see each other's progress, and signing out offers to remove yours from that browser. The **Account** page shows the sync status, and **Delete my data** removes the Drive copy. Google's sign-in lasts an hour, so after that the next click in the app opens a short Google window to renew it.

Without signing in, nothing is uploaded. Clearing your browsing data deletes your progress, so use **Export everything** or **Export results only** under **Question bank** now and then, and **Restore a backup** to bring it back or move to another computer.

This site does not include any test questions; you bring your own exports.

## Question sets in JSON

Besides PDFs, you can import your own question sets as a `.json` file with a `questions` list. Each question has `id`, `section`, `domain`, `skill`, `type` (`multiple_choice` or `student_produced`), `passage`, `prompt`, `choices` (`[{ "id": "A", "text": "..." }]`), `answer`, optional `accepted_answers`, and `explanation`. An optional `rules` list (`{ "id", "text" }`) is shown after each answer through a question's `rule_id`. A set becomes a study module as soon as it is imported.

## Running it on your own computer

With Python 3 installed, double-click `Start Module Builder.bat` (or run `python server.py`). Data is then saved in a `data` folder next to the app instead of in the browser.

Module Builder is an independent study tool and is not affiliated with or endorsed by College Board. SAT, PSAT/NMSQT and Bluebook are trademarks of College Board.
