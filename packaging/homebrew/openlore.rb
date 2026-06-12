# Homebrew formula for openlore.
#
# openlore is published to npm (https://www.npmjs.com/package/openlore); this
# formula installs that published tarball under a Homebrew-managed Node prefix,
# so `brew install` users get the same bits as `npm i -g openlore`.
#
# Status: staged for a future homebrew-core submission (not a personal tap). When
# the project clears Homebrew's notability bar, this file is the ready artifact to
# open against homebrew/homebrew-core, giving a plain `brew install openlore` with
# no tap. Until then the supported install is npm. Refresh `url`/`sha256` for the
# current release with `npm run homebrew:formula`. See packaging/homebrew/README.md.
class Openlore < Formula
  desc "Deterministic structural code-context substrate for coding agents"
  homepage "https://github.com/clay-good/OpenLore"
  url "https://registry.npmjs.org/openlore/-/openlore-2.0.16.tgz"
  sha256 "350c24fa7cec2b3df6ca58b316948df9fef939f497a12d72fe24e1cfdbb775e8"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    if Hardware::CPU.arm?
      rm_r Dir["#{libexec}/lib/node_modules/openlore/node_modules/**/prebuilds/darwin-x64"]
    else
      rm_r Dir["#{libexec}/lib/node_modules/openlore/node_modules/**/prebuilds/darwin-arm64"]
    end
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/openlore --version")
  end
end
