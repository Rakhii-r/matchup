module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@': './src',
            '@features': './src/features',
            '@core': './src/core',
            '@shared': './src/shared',
            '@app-providers': './src/app-providers',
          },
        },
      ],
      'react-native-reanimated/plugin',
    ],
  };
};
