# magic-error

## How do I install it?

`npm install --save magic-error`

## Usage

```js
import createMagicError from 'magic-error';

const err = createMagicError(new ReferenceError('Impossible does not exist'));
```

## How does it work?
It uses [proxy](https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots) and sets traps for 2 internal methods:
-  [[[GetOwnProperty]]](https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-getownproperty-p) 
-  [[[OwnPropertyKeys]]](https://tc39.es/ecma262/#sec-proxy-object-internal-methods-and-internal-slots-ownpropertykeys) 

Ok, cool, but I still don't have a clue how this crap is supposed to work.
I'll probably fail to describe it in a meaningful way and skip a couple of details, but let me try.
If you take a look at a method like [Object.keys](https://tc39.es/ecma262/#sec-object.keys), you should be able to see it invokes [[[EnumerableOwnPropertyNames]]](http.s://tc39.es/ecma262/#sec-enumerableownpropertynames).
Now, please take a look at the step 2 of [[EnumerableOwnPropertyNames]]. Yes, you see it right. It 'calls' [[OwnPropertyKeys]].
Then, step 4.II is kind of important (but not in our case, more on this later) as well in general, as if the desc[[Enumerable]] is not true, the key won't be included in the list.
All descriptors we return have enumerable set to true, because we'd have a nice TypeError otherwise.
The trap for [[GetOwnProperty]] internal method is needed due to that - we need to make properties enumerable and configurable. 

#### Why do we have that new Set in `ownKeys`?
It's caused by the fact the trap result cannot return duplicate entries. See the step 9 of [[OwnPropertyKeys]] internal slot.

#### What about [Object.getOwnPropertyNames](https://tc39.es/ecma262/#sec-object.getownpropertynames)?
Pretty much the same story. It has different steps, as, [[EnumerableOwnPropertyNames]] unlike it doesn't 'filter out' non-enumerable properties, but since everything is enumerable in our case, the output should be equal.

#### What about `for in` loop?
Alright - we need to get the [syntax]([https://tc39.es/ecma262/#sec-for-in-and-for-of-statements-runtime-semantics-labelledevaluation]) right first.
As you can see, all `for in` iteration methods 'pass' `enumerate` 'to' [ForIn/OfHeadEvaluation](https://tc39.es/ecma262/#sec-runtime-semantics-forin-div-ofheadevaluation-tdznames-expr-iterationkind).
Now, go ahead, look at step 6. [EnumerateObjectProperties](https://tc39.es/ecma262/#sec-enumerate-object-properties) is described quite nicely - there is even a code sample.

#### What about xyz?
Google it or search in spec.

## How does it differ from serialize-error?
Serialize-error can be used on production, while this thingy... well, I wouldn't use it.

Besides that, there a few other differences you most likely don't care about, but to name a few: 
    
- all available properties are exposed, i.e. columnNumber and lineNumber on Firefox,
- constructor is set to an actual initial error constructor,
- prototype is retained,
- instanceof works 'correctly'... I think,
- it's just cool.




