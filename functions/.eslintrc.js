module.exports = {
  env: {
    es6: true,
    node: true,
  },
  parserOptions: {
    "ecmaVersion": 2018,
  },
  extends: [
    "eslint:recommended",
    "google",
  ],
  rules: {
    "no-restricted-globals": ["error", "name", "length"],
    "prefer-arrow-callback": "error",
    "quotes": ["error", "double", {"allowTemplateLiterals": true}],
    "max-len": "off", // Desactiva la regla de longitud máxima de línea
    "camelcase": "off", // Desactiva la regla de camelcase
    "object-curly-spacing": ["error", "never"], // Exige que no haya espacios después de '{' y antes de '}'
    "require-jsdoc": "off", // Desactiva la regla require-jsdoc
  },
  overrides: [
    {
      files: ["**/*.spec.*"],
      env: {
        mocha: true,
      },
      rules: {},
    },
  ],
  globals: {},
};
