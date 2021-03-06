import * as sss from './shamir_secret_sharing';
import * as GF from './finite_field';
import { Secret, Share, Party, LocalStorageSession, MPC } from './mpc';
import { emulateStorageEvent, background, expectToBeReconstructable } from './test_utils';

describe('Variable', function() {
  it('holds sahres', function() {
    const a = new Secret('a')
    a.setShare(1, 1n)
    a.setShare(2, 2n)
    a.setShare(3, 3n)
    expect(a.getShare(1).value).toEqual(1n)
    expect(a.getShare(2).value).toEqual(2n)
    expect(a.getShare(3).value).toEqual(3n)
  });

  it('splits secret to shares', function() {
    const a = new Secret('a');
    a.value = 1n;

    const n = 3;
    const k = 2;
    a.split(n, k);

    expect(Object.keys(a.shares).length).toEqual(n);

    // secret is reconstructable from k out of the n shares.
    expect(sss.reconstruct([
      [BigInt(1), a.getShare(1).value],
      [BigInt(2), a.getShare(2).value],
      [BigInt(3), a.getShare(3).value],
    ])).toEqual(a.value);

    for (let [i, j] of [[1, 2], [1, 3], [2, 3]]) {
      expect(sss.reconstruct([
        [BigInt(i), a.getShare(i).value],
        [BigInt(j), a.getShare(j).value],
      ])).toEqual(a.value);
    }
  });

  it('reconstructs secret from shares', function() {
    const secret = 1n;
    const n = 3;
    const k = 2;
    const a = new Secret('a');
    for (let [idx, value] of sss.share(secret, n, k)) {
      a.setShare(idx, value);
    }

    expect(a.reconstruct()).toEqual(secret);
    expect(a.value).toEqual(secret);
  });
});
describe('Party', function() {
  let stubCleanup: Function;
  beforeAll(function() {
    stubCleanup = emulateStorageEvent();
  });
  afterAll(function() {
    stubCleanup();
  });
  it('sends share to peer', async function() {
    const session = LocalStorageSession.init('test');
    const p1 = new Party(1, session);
    const p2 = new Party(2, session);
    const p3 = new Party(3, session);

    // TODO: register in parallel
    await p1.connect();
    await p2.connect();
    await p3.connect();

    // all parties should connect each other
    expect(await p1.session.getParties()).toEqual(new Set([1, 2, 3]));
    expect(await p2.session.getParties()).toEqual(new Set([1, 2, 3]));
    expect(await p3.session.getParties()).toEqual(new Set([1, 2, 3]));

    // prepare secret 'a' and shares
    const a1 = new Secret('a', 1n);

    // p1 sends shares to peers
    for (let [idx, share] of Object.entries(a1.split(3, 2))) {
      if (idx == '1') continue;
      await p1.sendShare(share, Number(idx));
    }


    // peers should have the shares
    const a2 = new Share('a', 2)
    expect(await p2.receiveShare(a2)).toBeTrue();
    expect(a2).toEqual(a1.getShare(2));

    const a3 = new Share('a', 3)
    expect(await p3.receiveShare(a3)).toBeTrue();
    expect(a3).toEqual(a1.getShare(3));
  });

  it('recieves share', async function() {
    const session = LocalStorageSession.init('test');
    const p1 = new Party(1, session);
    const p2 = new Party(2, session);
    const p3 = new Party(3, session);

    // TODO: register in parallel
    await p1.connect();
    await p2.connect();
    await p3.connect();

    // Party1 waits a share of 'a'
    const a1 = new Share('a', 1);
    const received = p1.receiveShare(a1);

    const a2 = new Secret('a', 1n);
    a2.split(3, 2);

    background(() => {
      p2.sendShare(a2.getShare(1), 1);
    });

    expect(await received).toBeTrue();
  });
});

describe('MPC', function() {
  let stubCleanup: Function;
  beforeAll(function() {
    stubCleanup = emulateStorageEvent();
  });
  afterAll(function() {
    stubCleanup();
  });
  describe('add', function() {
    it('computes addition', async function() {
      const session = LocalStorageSession.init('test_addition');
      const p1 = new Party(1, session);
      const p2 = new Party(2, session);
      const p3 = new Party(3, session);
      const dealer = new Party(999, session);
      const conf = { n: 3, k: 2 }

      // All participants connect to the network
      p1.connect();
      p2.connect();
      p3.connect();
      dealer.connect();

      // Each party does calculation
      for (let p of [p1, p2, p3]) {
        background(async () => {
          const mpc = new MPC(p, conf);

          const a = new Share('a', p.id);
          const b = new Share('b', p.id);
          const c = new Share('c', p.id);
          await mpc.add(c, a, b);
          mpc.p.sendShare(c, dealer.id);
        });
      }

      // Dealer sends shares and recieves the computed shares from each party
      await background(async () => {
        const mpc = new MPC(dealer, conf);
        const a = new Secret('a', 2n);
        const b = new Secret('b', 3n);
        const c = new Secret('c');

        // broadcast shares of 'a' and 'b'
        for (let [idx, share] of Object.entries(mpc.split(a))) {
          await dealer.sendShare(share, Number(idx));
        }
        for (let [idx, share] of Object.entries(mpc.split(b))) {
          await dealer.sendShare(share, Number(idx));
        }

        // recieve result shares from parties
        for (let pId of [1, 2, 3]) {
          await dealer.receiveShare(c.getShare(pId));
        }
        expectToBeReconstructable(c, a.value + b.value);
      });
    });
  });
  describe('mul', function() {
    it('computes multiplication', async function() {
      const session = LocalStorageSession.init('test_multiplication');
      const p1 = new Party(1, session);
      const p2 = new Party(2, session);
      const p3 = new Party(3, session);
      const dealer = new Party(999, session);
      const conf = { n: 3, k: 2 }

      // All participants connect to the network
      p1.connect();
      p2.connect();
      p3.connect();
      dealer.connect();

      // Each party does calculation
      for (let p of [p1, p2, p3]) {
        background(async () => {
          const mpc = new MPC(p, conf);

          const a = new Share('a', p.id);
          const b = new Share('b', p.id);
          const c = new Share('c', p.id);
          await mpc.mul(c, a, b);
          mpc.p.sendShare(c, dealer.id);
        });
      }

      // Dealer sends shares and recieves the computed shares from each party
      await background(async () => {
        const mpc = new MPC(dealer, conf);
        const a = new Secret('a', 2n);
        const b = new Secret('b', 3n);
        const c = new Secret('c');

        // broadcast shares of 'a' and 'b'
        for (let [idx, share] of Object.entries(mpc.split(a))) {
          await dealer.sendShare(share, Number(idx));
        }
        for (let [idx, share] of Object.entries(mpc.split(b))) {
          await dealer.sendShare(share, Number(idx));
        }

        // recieve result shares from parties
        for (let pId of [1, 2, 3]) {
          await dealer.receiveShare(c.getShare(pId));
        }

        expectToBeReconstructable(c, a.value * b.value);
      });
    });
  });
  describe('inv', function() {
    it('calculates inversion without dealer', async function() {
      const session = LocalStorageSession.init('test_inversion_without_dealer');
      const p1 = new Party(1, session);
      const p2 = new Party(2, session);
      const p3 = new Party(3, session);
      const dealer = new Party(999, session);
      const conf = { n: 3, k: 2 }

      // All participants connect to the network
      p1.connect();
      p2.connect();
      p3.connect();
      dealer.connect();

      // Each party does calculation
      for (let p of [p1, p2, p3]) {
        background(async () => {
          const mpc = new MPC(p, conf);

          const a = new Share('a', p.id);
          const a_inv = new Share('a_inv', p.id);

          await mpc.inv(a_inv, a);

          mpc.p.sendShare(a_inv, dealer.id);
        });
      }

      // Dealer
      await background(async () => {
        const mpc = new MPC(dealer, conf);
        const a = new Secret('a', 2n);
        const a_inv = new Secret('a_inv');

        // send shares of a to parties
        for (let [idx, share] of Object.entries(mpc.split(a))) {
          await dealer.sendShare(share, Number(idx));
        }

        // recieve result shares from parties
        for (let pId of [1, 2, 3]) {
          await dealer.receiveShare(a_inv.getShare(pId));
        }

        expect(GF.mul(a_inv.reconstruct(), a.value)).toEqual(1n);
        expectToBeReconstructable(a_inv, a_inv.value);
      });
    });
  });
  describe('pow', function() {
    for (let params of [
      { x: 3n, k: 1, z: 3n },
      { x: 3n, k: 2, z: 9n },
      { x: 3n, k: 3, z: 27n },
      { x: 3n, k: 5, z: 243n },
      { x: 3n, k: 8, z: 6561n },
      { x: 3n, k: 13, z: 1594323n },
    ]) {
      it(`${params.x}^${params.k} = ${params.z}`, async function() {
        const session = LocalStorageSession.init(`test_power${params.k}`);
        const p1 = new Party(1, session);
        const p2 = new Party(2, session);
        const p3 = new Party(3, session);
        const dealer = new Party(999, session);
        const conf = { n: 3, k: 2 }

        // All participants connect to the network
        p1.connect();
        p2.connect();
        p3.connect();
        dealer.connect();

        // Each party does calculation
        for (let p of [p1, p2, p3]) {
          background(async () => {
            const mpc = new MPC(p, conf);
            const x = new Share('x', p.id);
            const z = new Share('x^k', p.id);
            await mpc.pow(z, x, params.k);
            mpc.p.sendShare(z, dealer.id);
          });
        }

        // Dealer sends shares and recieves the computed shares from each party
        await background(async () => {
          const mpc = new MPC(dealer, conf);
          const x = new Secret('x', params.x);
          const z = new Secret('x^k');

          // broadcast shares of 'a'
          for (let [idx, share] of Object.entries(mpc.split(x))) {
            await dealer.sendShare(share, Number(idx));
          }

          // recieve result shares from parties
          for (let pId of [1, 2, 3]) {
            await dealer.receiveShare(z.getShare(pId));
          }

          expectToBeReconstructable(z, params.z);
        });
      })
    }
  });
  describe('rand', function() {
    it('generates random shares in a distributed manner', async function() {
      const session = LocalStorageSession.init('test_rand');
      const p1 = new Party(1, session);
      const p2 = new Party(2, session);
      const p3 = new Party(3, session);
      const dealer = new Party(999, session);
      const conf = { n: 3, k: 2 };

      // All participants connect to the network
      p1.connect();
      p2.connect();
      p3.connect();
      dealer.connect();

      // Party
      for (let p of [p1, p2, p3]) {
        background(async () => {
          const mpc = new MPC(p, conf);

          const r = new Share('r', p.id);
          await mpc.rand(r);

          mpc.p.sendShare(r, dealer.id);
        });
      }

      // Dealer
      await background(async () => {
        const r = new Secret('r');

        // recieve result shares from parties
        for (let pId of [1, 2, 3]) {
          await dealer.receiveShare(r.getShare(pId));
        }

        expectToBeReconstructable(r);
      });
    });
  });
  describe('comtined arithmetics', function() {
    it('Given x, y, Caculates l = 3x^2 + a / 2y', async function() {
      const session = LocalStorageSession.init('test_combined');
      const p1 = new Party(1, session);
      const p2 = new Party(2, session);
      const p3 = new Party(3, session);
      const dealer = new Party(999, session);
      const conf = { n: 3, k: 2 }

      const a = 2n;

      // All participants connect to the network
      p1.connect();
      p2.connect();
      p3.connect();
      dealer.connect();

      // Each party does calculation
      for (let p of [p1, p2, p3]) {
        background(async () => {
          const mpc = new MPC(p, conf);
          const x = new Share('x', p.id);
          const y = new Share('y', p.id);

          await p.receiveShare(x);
          await p.receiveShare(y);

          const x_squared = new Share('x^2', p.id);
          await mpc.mul(x_squared, x, x);

          const nume = new Share('3x^2', p.id, x_squared.value * 3n + a);

          const denom = new Share('2y^-1', p.id);
          await mpc.inv(denom, new Share('2y', p.id, y.value * 2n));

          const l = new Share('lambda', p.id);

          await mpc.mul(l, nume, denom);

          mpc.p.sendShare(l, dealer.id);
        });
      }

      // Dealer sends shares and recieves the computed shares from each party
      await background(async () => {
        const mpc = new MPC(dealer, conf);
        const x = new Secret('x', 1n);
        const y = new Secret('y', 2n);

        // broadcast shares of 'x', 'y'
        for (let [idx, share] of Object.entries(mpc.split(x))) {
          await dealer.sendShare(share, Number(idx));
        }
        for (let [idx, share] of Object.entries(mpc.split(y))) {
          await dealer.sendShare(share, Number(idx));
        }

        // recieve result shares from parties
        const l = new Secret('lambda');
        for (let pId of [1, 2, 3]) {
          await dealer.receiveShare(l.getShare(pId));
        }
        l.reconstruct();

        // confirm that l * 2y = 3x^2  + a is on the koblitz curve
        const equition = GF.mul(l.value, y.value * 2n)
          == GF.add(GF.mul(GF.mul(x.value, x.value), 3n), a);
        expect(equition).toBeTrue();
      });
    })
  });
});
