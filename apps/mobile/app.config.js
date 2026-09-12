const { getProfile } = require('./scripts/android-build-config.cjs');

module.exports = ({ config }) => {
  const profile = getProfile(process.env.POCKETSRE_ANDROID_PROFILE);
  const suffix = { development: '.dev', internal: '.internal', production: '' }[profile];
  return {
    ...config,
    name: profile === 'production' ? config.name : `${config.name} ${profile}`,
    slug: `${config.slug}${suffix.replace('.', '-')}`,
    scheme: `pocketsre${suffix.replace('.', '-')}`,
    android: { ...config.android, package: `${config.android.package}${suffix}` },
    plugins: [
      ...config.plugins.map((plugin) =>
        Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
          ? [
              plugin[0],
              {
                android: {
                  ...plugin[1].android,
                  buildArchs: ['arm64-v8a', 'x86_64'],
                  usesCleartextTraffic: profile !== 'production',
                  extraProguardRules: '-keep class com.rnllama.** { *; }',
                },
              },
            ]
          : plugin,
      ),
      ['./plugins/withAndroidBuild.cjs', { profile }],
    ],
  };
};
