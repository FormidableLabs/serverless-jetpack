"use strict";

const { expect, use } = require("chai");
const sinonChai = require("sinon-chai");
const chaiAsPromised = require("chai-as-promised");

use(sinonChai);
use(chaiAsPromised);

global.expect = expect;
