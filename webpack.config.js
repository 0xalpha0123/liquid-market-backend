module.exports = {
  target: "node",
  mode: "development",
  entry: "./server.js",
  resolve: {
    modules: ["server", "node_modules"],
  },
  externals: [
    (function () {
      var IGNORES = ["electron"];
      return function (context, request, callback) {
        if (IGNORES.indexOf(request) >= 0) {
          return callback(null, "require('" + request + "')");
        }
        return callback();
      };
    })(),
  ],
};
