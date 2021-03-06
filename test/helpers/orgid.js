const { assertEvent } = require('../helpers/assertions');
const { zeroAddress, zeroBytes } = require('../helpers/constants');

/**
 * Generates an id on the base of string and solt
 * @param {string} string Part of the base for id generation
 * @param {atring} [solt=Math.random().toString()] Solt string
 */
const generateId = (string, solt = Math.random().toString()) => web3.utils.keccak256(`${string}${solt}`);
module.exports.generateId = generateId;

/**
 * Creates an organization
 * @param {Object} contract OrgId contract instance
 * @param {string} from Sender address
 * @param {string} uri Link to the json file online
 * @param {string} hash Hash of the json file, should be in bytes32 hex form
 * @returns {Promise<{string}>} The organization address
 */
module.exports.createOrganization = async (
    contract,
    from,
    hash,
    uri
) => {
    const result = await contract
        .methods['createOrganization(bytes32,bytes32,string,string,string)'](
            generateId(),
            hash,
            uri,
            '',
            ''
        )
        .send({ from });
    let organizationId;
    assertEvent(result, 'OrganizationCreated', [
        [
            'orgId',
            p => {
                organizationId = p;
            }
        ],
        [
            'owner',
            p => (p).should.equal(from)
        ]
    ]);

    const org = await contract
        .methods['getOrganization(bytes32)'](organizationId)
        .call();
    (org.orgId).should.equal(organizationId);
    (org.orgJsonUri).should.equal(uri);
    (org.orgJsonHash).should.equal(hash);
    (org.parentOrgId).should.equal(zeroBytes);
    (org.owner).should.equal(from);
    (org.director).should.equal(zeroAddress);
    (org.isActive).should.be.true;
    (org.isDirectorshipAccepted).should.be.false;

    return organizationId;
};
