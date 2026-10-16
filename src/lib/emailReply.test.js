import { emailDisplayHtml, emailFullHtml, plainTextToHtml, stripQuotedReply } from './emailReply';

describe('stripQuotedReply', () => {
  test('removes a Gmail thread, including nested earlier replies', () => {
    const text = [
      'Hey Eddie, Before you write it up, the last change I need is a percentage.',
      '',
      'Thanks',
      '',
      'On Tue, Oct 13, 2026 at 9:30 PM Aaron Goins <aaron@example.com> wrote:',
      '',
      '> Hey Eddie,',
      '> Option 1 is good for me!',
      '>',
      '> On Tue, Oct 13, 2026 at 10:29 AM Dream App Lab <',
      '> lab@inbound.dreamapplab.com> wrote:',
      '>> Hi Aaron,',
    ].join('\n');
    expect(stripQuotedReply(text)).toBe(
      'Hey Eddie, Before you write it up, the last change I need is a percentage.\n\nThanks'
    );
  });

  test('handles a "wrote:" header wrapped onto two lines', () => {
    const text = 'Sounds good.\n\nOn Tue, Oct 13, 2026 at 10:29 AM Dream App Lab <\nlab@inbound.dreamapplab.com> wrote:\n\n> Hi Aaron';
    expect(stripQuotedReply(text)).toBe('Sounds good.');
  });

  test('removes an Outlook original-message block', () => {
    const text = 'Yes, Thursday works.\r\n\r\n-----Original Message-----\r\nFrom: Eddie\r\nSent: Monday\r\nTo: Bob\r\nHello';
    expect(stripQuotedReply(text)).toBe('Yes, Thursday works.');
  });

  test('removes an Outlook From/Sent/To header block', () => {
    const text = 'Approved.\n\nFrom: Dream App Lab <lab@inbound.dreamapplab.com>\nSent: Monday, October 12, 2026 3:00 PM\nTo: Bob\nCc: Ann\nSubject: Quote\n\nHello';
    expect(stripQuotedReply(text)).toBe('Approved.');
  });

  test('keeps a sentence starting "On" that ends in "wrote:" when real text follows', () => {
    const text = 'Hi Eddie,\nOn the quote, my accountant wrote:\nplease add our tax ID.';
    expect(stripQuotedReply(text)).toBe(text);
  });

  test('keeps a pasted From/Date/To block with no Subject line', () => {
    const text = 'Forwarding the contact:\nFrom: Jane\nDate: 10/1\nTo: me\nPlease call her.';
    expect(stripQuotedReply(text)).toBe(text);
  });

  test('keeps inline answers written between quoted questions', () => {
    const text = 'Answers below:\n> Q1?\nTuesday\n> Q2?\n5k';
    expect(stripQuotedReply(text)).toBe(text);
  });

  test('removes an Apple Mail header and a mobile signature', () => {
    const text = 'Works for me.\n\nSent from my iPhone\n\nOn Oct 13, 2026, at 9:30 PM, Dream App Lab <lab@inbound.dreamapplab.com> wrote:\n\n> Hi Aaron';
    expect(stripQuotedReply(text)).toBe('Works for me.');
  });

  test('removes trailing ">" quoted lines with no header', () => {
    expect(stripQuotedReply('Got it\n> earlier text\n> more')).toBe('Got it');
  });

  test('leaves a reply with no quoted history unchanged', () => {
    expect(stripQuotedReply('Just one line.')).toBe('Just one line.');
  });

  test('keeps "on" and "wrote" used in normal sentences', () => {
    const text = 'On second thought, I wrote down the numbers.\nLet\'s talk Friday.';
    expect(stripQuotedReply(text)).toBe(text);
  });

  test('falls back to the full text if the whole email is quoted', () => {
    const text = '> only quoted text';
    expect(stripQuotedReply(text)).toBe('> only quoted text');
  });

  test('handles empty input', () => {
    expect(stripQuotedReply('')).toBe('');
    expect(stripQuotedReply(null)).toBe('');
  });
});

describe('plainTextToHtml', () => {
  test('escapes markup and keeps line breaks', () => {
    expect(plainTextToHtml('<img src=x onerror=alert(1)>\nA & B')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;<br>A &amp; B'
    );
  });
});

describe('emailDisplayHtml', () => {
  test('inbound replies are stripped and escaped', () => {
    const email = {
      direction: 'inbound',
      body: 'Option 1 <b>works</b>.\n\nOn Tue, Oct 13, 2026 at 10:29 AM Eddie wrote:\n> Hi',
    };
    expect(emailDisplayHtml(email)).toBe('Option 1 &lt;b&gt;works&lt;/b&gt;.');
  });

  test('outbound emails keep the HTML Eddie wrote', () => {
    expect(emailDisplayHtml({ direction: 'outbound', body: '<p>Hi <b>Aaron</b></p>' })).toBe(
      '<p>Hi <b>Aaron</b></p>'
    );
  });

  test('messages without a direction are treated as client text and escaped', () => {
    expect(emailDisplayHtml({ body: '<script>x</script>' })).toBe('&lt;script&gt;x&lt;/script&gt;');
  });
});

describe('emailFullHtml', () => {
  test('returns the full escaped email when quoted history was hidden', () => {
    const email = {
      direction: 'inbound',
      body: 'Yes.',
      bodyFull: 'Yes.\n\nOn Tue, Oct 13, 2026 at 10:29 AM Eddie wrote:\n> <b>Hi</b>',
    };
    expect(emailFullHtml(email)).toBe(
      'Yes.<br><br>On Tue, Oct 13, 2026 at 10:29 AM Eddie wrote:<br>&gt; &lt;b&gt;Hi&lt;/b&gt;'
    );
  });

  test('returns nothing when nothing was hidden or for outbound emails', () => {
    expect(emailFullHtml({ direction: 'inbound', body: 'Yes.', bodyFull: 'Yes.' })).toBe('');
    expect(emailFullHtml({ direction: 'outbound', body: '<p>Hi</p>' })).toBe('');
  });
});
