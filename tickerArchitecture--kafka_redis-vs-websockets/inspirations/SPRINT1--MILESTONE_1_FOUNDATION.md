# Milestone 1: Foundation & Core Scoring Engine (FastAPI Backend)

## 🎯 Objective
Build the core algorithmic foundation as a FastAPI backend that can calculate reliable 0-1 adherence scores for technical indicators on any stock symbol, with clean API endpoints ready for Next.js frontend integration.

## 📋 Dependencies
- **None** (This is the foundational milestone)

## ✅ What "Done" Looks Like
- Function `analyze_stock_indicators(symbol)` returns ranked `List[IndicatorScore]`
- Scores are properly normalized to 0-1 scale
- Supports 10+ major technical indicators (MAs, EMAs, Bollinger bands)
- Handles edge cases (new IPOs, insufficient data, market holidays)
- 95%+ accuracy when manually verified against charts
- Works reliably for 100+ popular stock symbols

## 🚀 What "Good Enough" Looks Like
- Works for 5 core indicators (MA 20/50/100/200, EMA 20)
- Scores make intuitive sense for 10 test stocks
- Basic error handling for common data issues
- 80%+ accuracy on manual spot checks

## 📝 Core Tasks
1. **Data Pipeline Setup**
   - yfinance integration with caching
   - Data validation and cleaning
   - Handle missing/insufficient data

2. **Indicator Calculation Engine**
   - Moving averages (multiple periods)
   - Exponential moving averages
   - Bollinger band midlines
   - Extensible framework for adding indicators

3. **Scoring Algorithm**
   - Residual calculation between price and indicators
   - Normalization to 0-1 scale
   - Time-weighted scoring (recent data matters more)

4. **Core Data Models**
   - IndicatorScore type definition
   - Input validation
   - Error handling structures

## ⚠️ Risks
- **Data Quality**: yfinance occasionally returns bad/missing data
- **Scoring Accuracy**: Normalization might not reflect true "adherence"
- **Performance**: Calculating many indicators could be slow
- **API Limits**: Rate limiting from yfinance during development

## 🌟 Opportunities
- **Clean Architecture**: Proper foundation enables rapid feature additions
- **Extensibility**: Plugin system for custom indicators
- **Caching Strategy**: Smart caching improves user experience
- **Algorithm Innovation**: Novel scoring approaches could provide edge

## 🕳️ Pitfalls
- **Over-engineering**: Building complex framework before proving concept
- **Perfectionism**: Spending too long on edge cases vs core functionality
- **Scope Creep**: Adding features instead of nailing core scoring
- **Data Assumptions**: Assuming data quality without proper validation

## 🔧 Technical Challenges
- **Normalization**: Converting residuals to meaningful 0-1 scores
- **Time Windows**: Choosing optimal lookback periods
- **Missing Data**: Handling stocks with insufficient history
- **Market Regimes**: Scores should adapt to different market conditions

## 🎲 Key Choices
- **Scoring Method**: MSE vs MAD vs R-squared vs custom metric
- **Normalization**: Exponential decay vs percentile ranking vs z-score
- **Time Weighting**: Linear vs exponential vs none
- **Data Source**: yfinance vs Alpha Vantage vs paid services

## 💳 Technical Debt Risks
- **Hardcoded Parameters**: Magic numbers in scoring formulas
- **Tight Coupling**: Data fetching mixed with calculation logic
- **No Configuration**: All settings embedded in code
- **Error Swallowing**: Silent failures that hide data issues

## 🔄 Potential Cascading Complexities
- **Multiple Timeframes**: Daily vs hourly scoring might need architecture changes
- **Real-time Updates**: Current batch approach won't scale to live data
- **Custom Indicators**: User-defined indicators require plugin system
- **Performance Optimization**: Vectorization might require code restructure

## 🧪 Testability
- **Unit Tests**: Each indicator calculation function
- **Integration Tests**: End-to-end scoring pipeline
- **Property Tests**: Score invariants (0 ≤ score ≤ 1)
- **Regression Tests**: Known-good results for reference stocks

## 📊 Measurability
- **Correlation Check**: High-scoring indicators visually match chart inspection
- **Consistency**: Same stock analyzed twice produces identical scores
- **Sanity Tests**: SPY should score high on major MAs during trends
- **Performance**: Sub-5 second analysis for any stock symbol

## 🚨 Must-Have vs Nice-to-Have

### Must-Have
- Core 5 indicators working reliably
- Proper 0-1 normalization
- Error handling for bad data
- Reproducible results

### Nice-to-Have
- Advanced indicators (VWAP, Fibonacci)
- Time-weighted scoring
- Performance optimization
- Extensive configuration options

## 🤖 LLM Contexts Needed

### Essential for Development
- **Financial APIs**: yfinance quirks, data formats, rate limiting
- **Technical Analysis**: Indicator calculation formulas, interpretation
- **Statistical Methods**: Normalization techniques, residual analysis
- **Python Patterns**: Clean architecture, type hints, error handling

### Should Add to CLAUDE.md
```markdown
## Technical Indicator Knowledge
- Moving averages: SMA vs EMA calculations
- Residual analysis: MSE, MAD, time-weighting approaches
- Financial data quirks: Splits, dividends, gaps, holidays
- Normalization methods: Exponential decay, percentile ranking

## Performance Considerations
- yfinance caching patterns
- Vectorized pandas operations
- Memory usage with large datasets
- Bottlenecks in indicator calculations
```

### Context Priming Suggestions
- Load examples of good vs bad technical indicator adherence
- Provide sample yfinance response structures
- Include edge case scenarios (IPOs, penny stocks, gaps)
- Reference financial domain vocabulary and conventions

## 🎯 Success Criteria
1. **Functional**: `analyze_stock_indicators("AAPL")` returns sensible ranked scores
2. **Accurate**: Manual verification shows scores reflect visual chart analysis
3. **Reliable**: Works for 90%+ of S&P 500 stocks without errors
4. **Fast**: Analysis completes in under 10 seconds per stock
5. **Foundation**: Architecture supports easy addition of new indicators
## 🧪 Testing Tasks (Milestone 1)

The following tasks implement comprehensive testing for the core scoring algorithm:

### Core Mathematical Unit Tests
- **Task**: task-003a-core-math-unit-tests.md
- **Description**: Unit tests for mathematical functions (MSE, normalization, score bounds)
- **Status**: In Review (10/11 tests exist, only price scale test missing)
- **Files**: `tests/test_core/test_scoring.py`

### Edge Case & Validation Tests  
- **Task**: task-003b-edge-case-unit-tests.md
- **Description**: Unit tests for edge cases, deterministic behavior, data coverage
- **Status**: To Do
- **Files**: `tests/test_core/test_scoring.py`

### Performance Benchmarks
- **Task**: task-003d-performance-benchmarks.md  
- **Description**: Speed and memory benchmarks for scoring algorithm
- **Status**: To Do
- **Files**: `tests/test_performance/test_scoring_benchmarks.py`

These testing tasks ensure the core foundation is solid before moving to API and validation milestones.
EOF < /dev/null