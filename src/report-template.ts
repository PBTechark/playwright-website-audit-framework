export const reportTemplate = (issuesJsonPath = './issues.json') => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Maintenance Report</title>
  <link rel="stylesheet" href="./report-styles.css">
</head>
<body>
  <div id="maintenance-root"></div>
  <script>window.__ISSUES_JSON_PATH = '${issuesJsonPath}';</script>
  <script src="./report-script.js"></script>
</body>
</html>`;

export default reportTemplate;
