import { createReadReporter } from './readOnce';

describe('createReadReporter', () => {
  it('reports the article the first time the end of the text is seen', () => {
    const reads: string[] = [];
    const reporter = createReadReporter(id => reads.push(id));

    reporter.report('3');

    expect(reads).toEqual(['3']);
  });

  it('reports once however often the page signals, because the page checks on a timer', () => {
    const reads: string[] = [];
    const reporter = createReadReporter(id => reads.push(id));

    reporter.report('3');
    reporter.report('3');
    reporter.report('3');

    expect(reads).toEqual(['3']);
  });

  it('stays silent after firing even if a different id arrives, since a reporter serves one screen', () => {
    const reads: string[] = [];
    const reporter = createReadReporter(id => reads.push(id));

    reporter.report('3');
    reporter.report('4');

    expect(reads).toEqual(['3']);
  });

  it('reports again from a new reporter, because opening the article again counts again', () => {
    const reads: string[] = [];
    const first = createReadReporter(id => reads.push(id));
    const second = createReadReporter(id => reads.push(id));

    first.report('3');
    second.report('3');

    expect(reads).toEqual(['3', '3']);
  });

  it('tells whether it has fired, so a screen can show the article as read', () => {
    const reporter = createReadReporter(() => undefined);

    expect(reporter.hasReported()).toBe(false);

    reporter.report('1');

    expect(reporter.hasReported()).toBe(true);
  });
});
