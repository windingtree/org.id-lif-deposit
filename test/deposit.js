const { TestHelper } = require('@openzeppelin/cli');
const { Contracts, ZWeb3 } = require('@openzeppelin/upgrades');

const {
    assertRevert,
    assertEvent
} = require('./helpers/assertions');
const {
    zeroAddress,
    zeroBytes,
    organizationUri,
    organizationHash
} = require('./helpers/constants');
const { toWeiEther } = require('./helpers/common');
const {
    createOrganization
} = require('./helpers/orgid');
const {
    setupToken,
    distributeLifTokens
} = require('./helpers/lif');
const {
    addDeposit,
    submitWithdrawalRequest,
    withdrawDeposit
} = require('./helpers/deposit');

let gasLimit = 8000000; // Like actual to the Ropsten

if (process.env.SOLIDITY_COVERAGE) {
    gasLimit = 0xfffffffffff;
    Contracts.setLocalBuildDir('./.coverage_artifacts/contracts');
}

// workaround for https://github.com/zeppelinos/zos/issues/704
Contracts.setArtifactsDefaults({
    gas: gasLimit,
});

ZWeb3.initialize(web3.currentProvider);

const OrgId = Contracts.getFromNodeModules('@windingtree/org.id', 'OrgId');
const LifDeposit = Contracts.getFromLocal('LifDepositTimeMachine');
const LifDepositUpgradeability = Contracts.getFromLocal('LifDepositUpgradeability');

require('chai')
    .use(require('bn-chai')(web3.utils.BN))
    .should();

contract('LifDeposit', accounts => {

    const lifOwner = accounts[1];
    const nonOwner = accounts[2];
    const orgIdOwner = accounts[3];
    const lifDepositOwner = accounts[4];
    const organizationOwner = accounts[5];
    const entityDirector = accounts[6];

    const defaultWithdrawalDelay = '600000';
    const defaultDepositValue = toWeiEther('1000');

    let lifToken;
    let project;
    let orgId;
    let lifDeposit;

    const setupTokenAndDistribute = async () => {
        lifToken = await setupToken(lifOwner);
        await distributeLifTokens(
            lifToken,
            lifOwner,
            '10000',
            [
                organizationOwner,
                entityDirector
            ]
        );
    };

    const setupOrgId = async () => {
        await project.setImplementation(
            OrgId,
            'OrgId'
        );
        orgId = await project.createProxy(OrgId, {
            initMethod: 'initialize',
            initArgs: [
                orgIdOwner
            ]
        });
    };

    const setupLifDeposit = async () => {
        lifDeposit = await project.createProxy(LifDeposit, {
            initMethod: 'initialize',
            initArgs: [
                lifDepositOwner,
                orgId.address,
                lifToken.address
            ]
        });
        await lifDeposit
            .methods['setWithdrawDelay(uint256)'](defaultWithdrawalDelay)
            .send({ from: lifDepositOwner });
    };

    const setupOrganization = () => createOrganization(
        orgId,
        organizationOwner,
        organizationHash,
        organizationUri
    );
    
    before(async () => {
        await setupTokenAndDistribute();
        project = await TestHelper({
            from: orgIdOwner
        });
        await setupOrgId();
        await setupLifDeposit();
    });

    describe('Initializer', () => {
        it('shoudl fail if orgId contract not supported ORGiD interface', async () => {
            await assertRevert(
                project.createProxy(LifDeposit, {
                    initMethod: 'initialize',
                    initArgs: [
                        lifDepositOwner,
                        lifToken.address, // wrong orgId contract
                        lifToken.address
                    ]
                })
            );
        });
    });

    describe('Ownable behaviour', () => {

        describe('#transferOwnership(address)', () => {

            after(async () => {
                await setupLifDeposit();
            });

            it('should fail if called by not an owner', async () => {
                await assertRevert(
                    lifDeposit
                        .methods['transferOwnership(address)'](nonOwner)
                        .send({
                            from: nonOwner
                        }),
                    'Ownable: caller is not the owner'
                );
            });
    
            it('should fail if new owner has zero address', async () => {
                await assertRevert(
                    lifDeposit
                        .methods['transferOwnership(address)'](zeroAddress)
                        .send({
                            from: lifDepositOwner
                        }),
                    'Ownable: new owner is the zero address'
                );
            });

            it('should transfer contract ownership', async () => {
                const result = await lifDeposit
                    .methods['transferOwnership(address)'](nonOwner)
                    .send({
                        from: lifDepositOwner
                    });
                assertEvent(result, 'OwnershipTransferred', [
                    [
                        'previousOwner',
                        p => (p).should.equal(lifDepositOwner)
                    ],
                    [
                        'newOwner',
                        p => (p).should.equal(nonOwner)
                    ],
                ]);
            });
        });

        describe('#owner()', () => {

            it('should return contract owner', async () => {
                (await lifDeposit.methods['owner()']().call())
                    .should.equal(lifDepositOwner);
            });
        });
    });

    describe('ERC165 interfaces', () => {

        it('should support IERC165 interface', async () => {
            (
                await lifDeposit
                    .methods['supportsInterface(bytes4)']('0x01ffc9a7')
                    .call()
            ).should.be.true;
        });

        it('should support ownable interface', async () => {
            (
                await lifDeposit
                    .methods['supportsInterface(bytes4)']('0x7f5828d0')
                    .call()
            ).should.be.true;
        });

        it('should support deposit interface', async () => {
            (
                await lifDeposit
                    .methods['supportsInterface(bytes4)']('0xe936be58')
                    .call()
            ).should.be.true;
        });
    });
    
    describe('Upgradeability behaviour', () => {

        after(async () => {
            await setupLifDeposit();
        });

        it('should upgrade proxy and reveal a new function and interface', async () => {
            lifDeposit = await project.upgradeProxy(
                lifDeposit.address,
                LifDepositUpgradeability,
                {
                    initMethod: 'initialize',
                    initArgs: []
                }
            );
            lifDeposit = await LifDepositUpgradeability.at(lifDeposit.address);
            await lifDeposit.methods['setupNewStorage(uint256)']('100').send({
                from: lifDepositOwner
            });
            (await lifDeposit.methods['newFunction()']().call()).should.equal('100');
            (
                await lifDeposit
                    .methods['supportsInterface(bytes4)']('0x1b28d63e')
                    .call()
            ).should.be.true;
        });
    });

    describe('Lif deposit', () => {
        
        describe('#getLifTokenAddress()', () => {

            it('should return Lif token address', async () => {
                (
                    await lifDeposit.methods['getLifTokenAddress()']().call()
                ).should.equal(lifToken.address);
            });
        });

        describe('#addDeposit(bytes32,uint256)', () => {
            let organizationId;

            before(async () => {
                organizationId = await setupOrganization();
            });

            it('should fail if organization not found', async () => {
                await assertRevert(
                    addDeposit(
                        lifDeposit,
                        organizationOwner,
                        zeroBytes,
                        toWeiEther('1000'),
                        lifToken
                    ),
                    'LifDeposit: Organization not found'
                );
            });

            it('should fail if called not by an organization owner ot director', async () => {
                await assertRevert(
                    addDeposit(
                        lifDeposit,
                        nonOwner,
                        organizationId,
                        defaultDepositValue,
                        lifToken
                    ),
                    'LifDeposit: action not authorized (must be owner or director)'
                );
            });

            it('should fail if zero value provided', async () => {
                await assertRevert(
                    addDeposit(
                        lifDeposit,
                        organizationOwner,
                        organizationId,
                        '0',
                        lifToken
                    ),
                    'LifDeposit: Invalid deposit value'
                );
            });

            it('should fail if Lif token allowance not sufficient', async () => {
                await assertRevert(
                    addDeposit(
                        lifDeposit,
                        organizationOwner,
                        organizationId,
                        defaultDepositValue
                    ),
                    'SafeERC20: low-level call failed'
                );
            });

            it('should add deposit', async () => {
                await addDeposit(
                    lifDeposit,
                    organizationOwner,
                    organizationId,
                    defaultDepositValue,
                    lifToken
                );
            });
        });

        describe('#balanceOf(uint256)', () => {
            let organizationId;

            before(async () => {
                organizationId = await setupOrganization();
            });

            it('should return 0 if no deposits has been added', async () => {
                (await lifDeposit.methods['balanceOf(bytes32)'](zeroBytes).call())
                    .should.eq.BN(0);
            });

            it('should return deposit value', async () => {
                await addDeposit(
                    lifDeposit,
                    organizationOwner,
                    organizationId,
                    defaultDepositValue,
                    lifToken
                );
                (await lifDeposit.methods['balanceOf(bytes32)'](organizationId).call())
                    .should.eq.BN(defaultDepositValue);
            });
        });

        describe('#setWithdrawDelay(uint256)', () => {

            after(async () => {
                await setupLifDeposit();
            });

            it('should fail if called not by an owner', async () => {
                await assertRevert(
                    lifDeposit
                        .methods['setWithdrawDelay(uint256)']('6000')
                        .send({ from: nonOwner }),
                    'Ownable: caller is not the owner'
                );
            });

            it('should change withdrawal delay', async () => {
                const delay = '6000';
                const result = await lifDeposit
                    .methods['setWithdrawDelay(uint256)'](delay)
                    .send({ from: lifDepositOwner });
                assertEvent(result, 'WithdrawDelayChanged', [
                    [
                        'previousWithdrawDelay',
                        p => (p).should.equal(defaultWithdrawalDelay)
                    ],
                    [
                        'newWithdrawDelay',
                        p => (p).should.equal(delay)
                    ]
                ]);
            });
        });

        describe('#getWithdrawDelay()', () => {

            after(async () => {
                await setupLifDeposit();
            });

            it('should return withdrawDelay', async () => {
                (
                    await lifDeposit.methods['getWithdrawDelay()']().call()
                ).should.equal(defaultWithdrawalDelay);
                const delay = '6000';
                await lifDeposit
                    .methods['setWithdrawDelay(uint256)'](delay)
                    .send({ from: lifDepositOwner });
                (
                    await lifDeposit.methods['getWithdrawDelay()']().call()
                ).should.equal(delay);
            });
        });

        describe('#submitWithdrawalRequest(bytes32,uint256)', () => {
            let organizationId;
            const extraDepositValue = toWeiEther('1001');

            before(async () => {
                organizationId = await setupOrganization();
                await addDeposit(
                    lifDeposit,
                    organizationOwner,
                    organizationId,
                    defaultDepositValue,
                    lifToken
                );
            });

            it('should fail if organization not found', async () => {
                await assertRevert(
                    submitWithdrawalRequest(
                        lifDeposit,
                        organizationOwner,
                        lifDepositOwner,
                        zeroBytes,
                        defaultDepositValue
                    ),
                    'LifDeposit: Organization not found'
                );
            });

            it('should fail if called not by an organization owner or director', async () => {
                await assertRevert(
                    submitWithdrawalRequest(
                        lifDeposit,
                        nonOwner,
                        lifDepositOwner,
                        organizationId,
                        defaultDepositValue
                    ),
                    'LifDeposit: action not authorized (must be owner or director)'
                );
            });

            it('should fail if zero withdrawal value has been sent', async () => {
                await assertRevert(
                    submitWithdrawalRequest(
                        lifDeposit,
                        organizationOwner,
                        lifDepositOwner,
                        organizationId,
                        '0'
                    ),
                    'LifDeposit: Invalid withdrawal value'
                );
            });

            it('should fail if deposit balance is insufficient to withdraw', async () => {
                await assertRevert(
                    submitWithdrawalRequest(
                        lifDeposit,
                        organizationOwner,
                        lifDepositOwner,
                        organizationId,
                        extraDepositValue
                    ),
                    'LifDeposit: Insufficient balance'
                );
            });

            it('should submit withdrawal request', async () => {
                await submitWithdrawalRequest(
                    lifDeposit,
                    organizationOwner,
                    lifDepositOwner,
                    organizationId,
                    defaultDepositValue
                );
            });
        });

        describe('#getWithdrawalRequest(bytes32)', () => {
            let organizationId;
            let organizationId2;
            let withdrawalRequest;

            before(async () => {
                organizationId = await setupOrganization();
                organizationId2 = await setupOrganization();
                await addDeposit(
                    lifDeposit,
                    organizationOwner,
                    organizationId,
                    defaultDepositValue,
                    lifToken
                );
                await addDeposit(
                    lifDeposit,
                    organizationOwner,
                    organizationId2,
                    defaultDepositValue,
                    lifToken
                );
                withdrawalRequest = await submitWithdrawalRequest(
                    lifDeposit,
                    organizationOwner,
                    lifDepositOwner,
                    organizationId,
                    defaultDepositValue
                );
            });

            it('should return exists=false if organization not found', async () => {
                (await lifDeposit
                    .methods['getWithdrawalRequest(bytes32)'](zeroBytes)
                    .call()).should.has.property('exists').to.false;
            });

            it('should return exists=false withdrawal request not found', async () => {
                (await lifDeposit
                    .methods['getWithdrawalRequest(bytes32)'](organizationId2)
                    .call()).should.has.property('exists').to.false;
            });

            it('should return withrdawal request info', async () => {
                const request = await lifDeposit
                    .methods['getWithdrawalRequest(bytes32)'](organizationId)
                    .call();
                (await lifDeposit
                    .methods['getWithdrawalRequest(bytes32)'](organizationId)
                    .call()).should.has.property('exists').to.true;
                (request).should.be.an('object')
                    .that.has.property('value')
                    .to.equal(defaultDepositValue);
                (request).should.be.an('object')
                    .that.has.property('withdrawTime')
                    .to.equal(withdrawalRequest.withdrawTime);
            });
        });

        describe('#withdrawDeposit(bytes32)', () => {
            let organizationId;
            
            before(async () => {
                organizationId = await setupOrganization();
                await addDeposit(
                    lifDeposit,
                    organizationOwner,
                    organizationId,
                    defaultDepositValue,
                    lifToken
                );
                await submitWithdrawalRequest(
                    lifDeposit,
                    organizationOwner,
                    lifDepositOwner,
                    organizationId,
                    defaultDepositValue
                );
            });

            it('should fail if orgainzation not found', async () => {
                await assertRevert(
                    withdrawDeposit(
                        lifDeposit,
                        organizationOwner,
                        lifDepositOwner,
                        zeroBytes
                    ),
                    'LifDeposit: Organization not found'
                );
            });

            it('should fail if called not by organization owner or director', async () => {
                await assertRevert(
                    withdrawDeposit(
                        lifDeposit,
                        nonOwner,
                        lifDepositOwner,
                        organizationId
                    ),
                    'LifDeposit: action not authorized (must be owner or director)'
                );
            });

            it('should fail if withdrawal request not found', async () => {
                const organizationId2 = await setupOrganization();
                await assertRevert(
                    withdrawDeposit(
                        lifDeposit,
                        organizationOwner,
                        lifDepositOwner,
                        organizationId2
                    ),
                    'LifDeposit: Withdrawal request not found'
                );
            });

            it('should fail if withdrawal request delay period not passed', async () => {
                await assertRevert(
                    withdrawDeposit(
                        lifDeposit,
                        organizationOwner,
                        lifDepositOwner,
                        organizationId
                    ),
                    'LifDeposit: Withdrawal request delay period not passed'
                );
            });

            it('should withdraw deposit', async () => {
                await withdrawDeposit(
                    lifDeposit,
                    organizationOwner,
                    lifDepositOwner,
                    organizationId,
                    true // this option is rewinding time to the withdrawalTime
                );
            });
        });
    });
});
