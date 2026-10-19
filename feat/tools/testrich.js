export default {
  name: 'testrich',
  aliases: ['richdemo', 'aidemo'],
  tags: 'tools',
  description: 'Demo rich response AI: teks, code block, tabel, LaTeX',
  async run(ctx) {
    const msg = {
      botForwardedMessage: {
        message: {
          richResponseMessage: {
            messageType: 1,
            submessages: [
              {
                messageType: 2,
                messageText: '🚀 *JH-RICH RESPONSE DEMO*\n_FionyVerse AI Protocol_'
              },
              {
                messageType: 5,
                codeMetadata: {
                  codeLanguage: 'javascript',
                  codeBlocks: [
                    { highlightType: 1, codeContent: 'const ' },
                    { highlightType: 0, codeContent: 'love = ' },
                    { highlightType: 3, codeContent: "'Fiony ♡ JH'" },
                    { highlightType: 0, codeContent: ';\n' },
                    { highlightType: 2, codeContent: 'console.log' },
                    { highlightType: 0, codeContent: '(love);' }
                  ]
                }
              },
              {
                messageType: 4,
                tableMetadata: {
                  title: 'Feature Comparison',
                  rows: [
                    { items: ['Feature', 'Zapo', 'Native'], isHeading: true },
                    { items: ['Rich Text', 'Full', 'Yes'], isHeading: false },
                    { items: ['Code Block', 'Full', 'Yes'], isHeading: false },
                    { items: ['Table', 'Experimental', 'Yes'], isHeading: false },
                    { items: ['LaTeX', 'Text-Only', 'No'], isHeading: false }
                  ]
                }
              },
              {
                messageType: 8,
                latexMetadata: {
                  text: 'Math formula demo: ',
                  expressions: [
                    { latexExpression: 'E = mc^2', width: 100, height: 50 }
                  ]
                }
              },
              {
                messageType: 2,
                messageText: '\n> _*Made with♡ by JamvanHax0r*_\n> _*Powered by FionyVerse*_'
              }
            ],
            contextInfo: {
              forwardingScore: 999,
              isForwarded: true,
              forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
              forwardOrigin: 4
            }
          }
        }
      }
    };
    await ctx.client.message.send(ctx.chat, msg, {
      additionalAttributes: { type: 'text' }
    });
    await ctx.react('🚀');
  }
};