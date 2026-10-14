# Contributing

Thanks for wanting to help. Issues and pull requests are welcome.

- **Bugs:** open an issue with what you did, what you expected and what happened. Include your OS
  and `node -v`. Never attach original photos with location data.
- **Changes:** keep them small and focused, one topic per pull request. For anything larger,
  open an issue first so we can agree on the approach.
- **Style:** plain JavaScript (ES modules), no build step, no framework. Match the surrounding code
  and its comments. Ask before adding an npm dependency; there are two on purpose.
- **Tests:** `npm test` must pass. Add or adjust a test for behaviour you change; the suite runs the
  real admin against a temporary gallery and a local bare git repository, so it never touches your
  own photos.
- **Privacy rules the code keeps:** published images carry no metadata from the original (never GPS),
  drafts never reach git, the contact e-mail is never stored whole. Changes must keep all three.

By contributing you agree that your contribution is licensed under the MIT License of this project.
