// jshint node:true
'use strict';

const _ = require('lodash');
const istanbulUtils = require('istanbul/lib/object-utils');

const UNSTARTED = {};

const AggregatedCoverageReporter = function(injector, logger, config, baseReporterDecorator, formatError) {
  const log = logger.create('reporter:parallel-coverage');
  // Create the original reporters
  const locals = {
    baseReporterDecorator: ['value', baseReporterDecorator],
    formatError: ['value', formatError]
  };
  const reporters = config.coverageReporters
    .map((name) => {
      log.debug(`instantiating reporter:${name}`);
      return {
        name,
        reporter: injector.createChild([locals], [`reporter:${name}`]).get(`reporter:${name}`)
      };
    });
  let aggregatedBrowserState;

  const callThrough = _.rest((fnName, args) => {
    reporters.forEach(({name, reporter}) => {
      if (_.isFunction(reporter[fnName])) {
        log.debug(`relaying ${fnName}() on reporter:${name}`);
        reporter[fnName].apply(reporter, args);
      }
    });
  });

  const getAlias = (browser) => ({
    // TODO: Do we need to add any additional props to the Browser interface?
    name: browser.name,
    id: config.browserIdAlias[browser.name]
  });

  const getStartedBrowserCount = (aggregate) =>
    _.chain(aggregate.real)
      .filter((browser) => browser === UNSTARTED)
      .size()
      .value();

  const getFinishedBrowserCount = (aggregate) =>
    _.chain(aggregate.real)
      .reject((browser) => browser === UNSTARTED)
      .size()
      .value();

  const coverageCombiner = (a, b) => {
    if (a && b) return istanbulUtils.mergeFileCoverage(a, b);
    if (a) return a;
    if (b) return b;
    throw new Error('attempted to combine coverage from 2 null sources');
  };
  const combineBrowserResults = (aggregate) => {
    const coverages = _.map(aggregate.real, 'coverage');
    const args = [{}].concat(coverages, coverageCombiner);
    return _.extendWith.apply(_, args);
  };

  this.onRunStart = function() {
    aggregatedBrowserState = {};
    callThrough('onRunStart');
  };

  this.onBrowserStart = function(browser) {
    const aggregate = aggregatedBrowserState[browser.name] =
      aggregatedBrowserState[browser.name] ||
      {alias: getAlias(browser), real: {}};

    aggregate.real[browser.id] = UNSTARTED;

    // Call through on the very first browser start
    if (getStartedBrowserCount(aggregate) === 1) {
      callThrough('onBrowserStart', aggregate.alias);
    }
  };

  this.onSpecComplete = function (browser, result) {
    // We can passthrough this call multiple times for each browser
    const aggregate = aggregatedBrowserState[browser.name];
    if (aggregate) {
      // TODO: Does result have any other info that needs to be aggregated or removed?
      callThrough('onSpecComplete', aggregate.alias, result);
    }
  };

  this.onBrowserComplete = function(browser, result) {
    // We need to keep track of the completed browsers and call through
    // only when all are complete for the given cluster
    const aggregate = aggregatedBrowserState[browser.name];
    if (aggregate) {
      aggregate.real[browser.id] = result;
      if (getFinishedBrowserCount(aggregate) === config.executors) {
        const coverage = combineBrowserResults(aggregate);
        // TODO: Do we need to pass additional result data besides coverage?
        callThrough('onBrowserComplete', aggregate.alias, {coverage});
      }
    }
  };


  this.onRunComplete = function(browsers, results) {
    const browsersArray = [];
    // We get a Collection, not a real array so lodash fails
    browsers.forEach((b) => browsersArray.push(b));
    // Get a distinct list of alias'ed browsers and call through with the results
    const aggregatedBrowsers = _.chain(browsersArray)
      .map('name')
      .uniq()
      .map((name) => aggregatedBrowserState[name])
      .filter()
      .map('alias')
      .value();
    callThrough('onRunComplete', aggregatedBrowsers, results);
  };

  this.onExit = function(done) {
    callThrough('onExit', done);
  };
};

AggregatedCoverageReporter.$inject = ['injector', 'logger', 'config.parallelOptions', 'baseReporterDecorator', 'formatError'];
module.exports = AggregatedCoverageReporter;