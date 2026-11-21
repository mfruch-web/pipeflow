// Site-wide settings. Edit these before you launch.
window.PIPEFLOW_CONFIG = {
  name: 'Pipeflow',

  // Puzzle #1 is this date. Everything after counts up from here.
  launchDate: '2026-11-21',

  // Shown at the end of the share text. Set it to your real domain.
  siteUrl: 'mfruch-web.github.io/pipeflow',

  // Google AdSense. Leave the client empty until your account is approved;
  // the ad slots stay hidden until then.
  // client looks like 'ca-pub-1234567890123456'; slot IDs come from the AdSense dashboard.
  adsense: {
    client: '',
    slots: {
      results: '', // inside the results card, after a solve
      footer: '',  // below the game, away from the board
    },
  },
};
