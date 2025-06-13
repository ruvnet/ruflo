module.exports = {
  "extends": "@istanbuljs/nyc-config-typescript",
  "include": ["src/**/*.ts"],
  "exclude": [
    "src/**/*.test.ts",
    "src/test/**/*"
  ],
  "reporter": ["text", "html", "lcov"],
  "all": true,
  "check-coverage": false,
  "branches": 50,
  "lines": 50,
  "functions": 50,
  "statements": 50
};