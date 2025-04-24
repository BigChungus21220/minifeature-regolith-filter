'use strict'

var chai = require('chai')
var resolveAllOf = require('../../src/index')
var expect = chai.expect

describe('resolveAllOf', function () {
  it('with refereces and description siblings', function () {
    const fragment = {
      allOf: [
        { $ref: '#/properties/AAAAA/allOf/0', description: 'BBBBB' },
        { examples: ['BBBBB'] }
      ]
    }
    const result = resolveAllOf(fragment, {
      deep: false,
      resolvers: resolveAllOf.stoplightResolvers,
      $refResolver() {
        return { description: 'AAAAA', type: 'string' }
      }
    })
    expect(result).to.eql({
      type: 'string',
      description: 'BBBBB',
      examples: ['BBBBB']
    })
  })
  it('with refereces and summary siblings', function () {
    const fragment = {
      allOf: [
        { $ref: '#/properties/AAAAA/allOf/0', summary: 'BBBBB is used for payment processing' },
        { examples: ['BBBBB'] }
      ]
    }
    const result = resolveAllOf(fragment, {
      deep: false,
      resolvers: resolveAllOf.stoplightResolvers,
      $refResolver() {
        return { summary: 'AAAAA is used for puppy adoption', type: 'string' }
      }
    })
    expect(result).to.eql({
      type: 'string',
      summary: 'BBBBB is used for payment processing',
      examples: ['BBBBB']
    })
  })
  it('with refereces and no siblings', function () {
    const fragment = {
      allOf: [
        { $ref: '#/properties/AAAAA/allOf/0' },
        { examples: ['BBBBB'] }
      ]
    }
    const result = resolveAllOf(fragment, {
      deep: false,
      resolvers: resolveAllOf.stoplightResolvers,
      $refResolver() {
        return { description: 'AAAAA', summary: 'AAAAA is used for puppy adoption', type: 'string' }
      }
    })
    expect(result).to.eql({
      type: 'string',
      description: 'AAAAA',
      summary: 'AAAAA is used for puppy adoption',
      examples: ['BBBBB']
    })
  })
})
